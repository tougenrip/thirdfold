// Scenes are content too, but they stay on the server (a table holds the
// story's secrets: hidden doors, what is in the dark). The pipeline checks
// every adventure's tables, and the builder's example's, against the manifest
// instead: every prop has a model, every figure the story puts on a table
// (people, characters, enemies) has one of its kind, every table's
// environment exists, and no table makes a viewer download or hold more than
// TABLE_BUDGETS (#193).

import {
	GRADE_TONE_MAPPER,
	type Manifest,
	type ModelEntry,
	type ModelKind,
	type TextureEntry
} from '../../src/lib/assets/manifest';
import { TEXTURE_DETAILS, sizeFor, sizesOf, type TextureDetail } from '../../src/lib/assets/detail';
import type { AdventureDef } from '../adventure/define';
import { FLOOR_IDS } from '../../src/lib/game/floor';
import { parseSceneFile, type SceneFile } from '../../src/lib/game/scene-file';
import { exampleAdventure } from '../../src/lib/adventure/example';
import { loadAdventureFile } from '../../src/lib/adventure/file';
import { ADVENTURES } from '../adventures';

const MB = 1024 * 1024;

/**
 * What one table's assets may add up to (docs/PERFORMANCE.md, "Asset budgets"), each at a texture
 * detail (detail.ts): desktop at medium, what the medium tier (the reference) draws, and mobile at
 * low, what phones start on (its KTX2 at RGBA8). High is reported, not held to them. Starting values, confirmed per tier in #155: change them
 * only deliberately, with the reason in docs/PERFORMANCE.md.
 */
export const TABLE_BUDGETS = {
	desktop: { download: 15 * MB, gpu: 160 * MB, detail: 'medium' },
	mobile: { download: 6 * MB, gpu: 80 * MB, detail: 'low' }
} as const satisfies Record<string, { download: number; gpu: number; detail: TextureDetail }>;

/** What a table refers to: its environment and the models on it or brought onto it. */
export interface TableRefs {
	environment: string | null;
	models: string[];
}

type PerDetail = Record<TextureDetail, number>;

/**
 * A table's assets added up at each texture detail: bytes to download (a variant after its base,
 * which always comes first) and GPU bytes; and its GPU bytes on a phone at low.
 */
export interface TableCost {
	download: PerDetail;
	gpu: PerDetail;
	mobile: number;
}

const perDetail = (f: (d: TextureDetail) => number) =>
	Object.fromEntries(TEXTURE_DETAILS.map((d) => [d, f(d)])) as PerDetail;

/** A file's download and GPU bytes at each detail: the base, or the base then a variant. */
function atDetails(entry: TextureEntry | ModelEntry): { download: PerDetail; gpu: PerDetail } {
	const variant = (d: TextureDetail) =>
		entry.variants?.find((v) => v.size === sizeFor(sizesOf(entry), d));
	return {
		download: perDetail((d) => entry.bytes + (variant(d)?.bytes ?? 0)),
		gpu: perDetail((d) => variant(d)?.gpuBytes ?? entry.gpuBytes)
	};
}

/**
 * Sums the files a table needs, each once however often it is used: the environment's materials'
 * maps, its surfaces, its grades for the tone mapper in use, and the models with their preview and
 * the materials they wear; plus the Basis transcoder once when any of it is KTX2 or cooked.
 */
export function tableBudget(manifest: Manifest, refs: TableRefs): TableCost {
	const textures = new Set<string>();
	const addMaterial = (id: string) => {
		const m = manifest.materials[id];
		for (const t of [m?.map, m?.normal, m?.orm]) if (t) textures.add(t);
	};
	const env = refs.environment ? manifest.environments[refs.environment] : undefined;
	if (env) {
		for (const id of [env.surface, env.ground, env.walls, env.table]) if (id) addMaterial(id);
		for (const id of Object.values(env.lut?.[GRADE_TONE_MAPPER] ?? {})) textures.add(id);
		for (const s of [...(env.surfaces?.floors ?? []), ...(env.surfaces?.walls ?? [])]) {
			const surface = manifest.surfaces[s];
			if (surface) for (const t of [surface.albedo, surface.normal, surface.orm]) textures.add(t);
		}
	}
	const cost: TableCost = { download: perDetail(() => 0), gpu: perDetail(() => 0), mobile: 0 };
	const add = (entry: TextureEntry | ModelEntry, extra = 0) => {
		const at = atDetails(entry);
		for (const d of TEXTURE_DETAILS) {
			cost.download[d] += at.download[d] + extra;
			cost.gpu[d] += at.gpu[d];
		}
	};
	let basis = false;
	for (const id of new Set(refs.models)) {
		const m = manifest.models[id];
		if (!m) continue;
		add(m, m.preview?.bytes ?? 0);
		// ponytail: a cooked model's geometry is counted at RGBA8 too; a bound, not the figure.
		cost.mobile += m.cooked ? m.gpuBytes * RGBA8 : m.gpuBytes;
		basis ||= m.cooked === true;
		for (const material of m.materials ?? []) addMaterial(material);
	}
	for (const id of textures) {
		const t = manifest.textures[id];
		if (!t) continue;
		add(t);
		cost.mobile += t.gpuBytes * (t.format === 'ktx2' ? RGBA8 : 1);
		basis ||= t.format === 'ktx2';
	}
	if (basis)
		for (const d of TEXTURE_DETAILS) cost.download[d] += manifest.decoders?.basis.bytes ?? 0;
	return cost;
}

/**
 * KTX2 on the GPU at RGBA8 against the 8 bits a texel `gpuBytes` counts: what a phone without a
 * compressed format the transcoder targets gets instead (#187).
 */
const RGBA8 = 4;

/** What the budgets make of a table's cost; empty when it fits. */
export function overBudget(cost: TableCost): string[] {
	const over: string[] = [];
	for (const tier of ['desktop', 'mobile'] as const) {
		const b = TABLE_BUDGETS[tier];
		const download = cost.download[b.detail];
		const gpu = tier === 'mobile' ? cost.mobile : cost.gpu[b.detail];
		if (download > b.download)
			over.push(`${mb(download)} download over the ${tier} ${mb(b.download)} budget`);
		if (gpu > b.gpu) over.push(`${mb(gpu)} GPU over the ${tier} ${mb(b.gpu)} budget`);
	}
	return over;
}

const mb = (bytes: number) => `${(bytes / MB).toFixed(1)} MB`;

interface Table {
	location: string;
	scene: SceneFile;
	refs: TableRefs;
}

/** The adventures checked: the built-in ones, and the builder's example; or why the example won't load. */
export function adventures(): (AdventureDef | string)[] {
	const example = loadAdventureFile(exampleAdventure(), 'example');
	return [...ADVENTURES, example.ok ? example.adventure : `example: ${example.error}`];
}

/**
 * The floors drawn with a surface of the library (#187), whose id is the floor's: plain is the
 * table's own, water is drawn as water (#120) and the void is nothing.
 */
export const SURFACE_FLOORS = FLOOR_IDS.filter(
	(f) => f !== 'plain' && f !== 'water' && f !== 'void'
);

/**
 * What the stories' tables refer to that the manifest lacks, or that goes over a budget, and
 * an environment with surfaces missing one for a floor (a GM may paint any floor anywhere);
 * empty when all is well.
 */
export function checkScenes(manifest: Manifest): string[] {
	const problems: string[] = [];
	for (const [id, env] of Object.entries(manifest.environments)) {
		for (const floor of SURFACE_FLOORS) {
			if (env.surfaces && !env.surfaces.floors.includes(floor))
				problems.push(`environment ${id}: no surface for the ${floor} floor`);
		}
	}
	for (const A of adventures()) {
		if (typeof A === 'string') problems.push(A);
		else problems.push(...checkAdventure(manifest, A).map((p) => `${A.id}: ${p}`));
	}
	return problems;
}

/** One line per environment and per table: what it downloads and holds on the GPU. */
export function sceneReport(manifest: Manifest): string[] {
	const cols = (name: string, ...rest: string[]) =>
		`${name.padEnd(28)}${rest.map((c) => c.padStart(12)).join('')}`;
	const kB = (bytes: number) => `${Math.round(bytes / 1024)} kB`;
	const row = (name: string, c: TableCost) =>
		cols(
			name,
			...TEXTURE_DETAILS.map((d) => kB(c.download[d])),
			...TEXTURE_DETAILS.map((d) => kB(c.gpu[d])),
			kB(c.mobile)
		);
	const lines = [
		cols(
			'table',
			...TEXTURE_DETAILS.map((d) => `down ${d}`),
			...TEXTURE_DETAILS.map((d) => `GPU ${d}`),
			'mobile GPU'
		)
	];
	for (const id of Object.keys(manifest.environments))
		lines.push(row(`(${id})`, tableBudget(manifest, { environment: id, models: [] })));
	for (const A of adventures()) {
		if (typeof A === 'string') continue;
		for (const t of tablesOf(A).tables)
			lines.push(row(`${A.id}/${t.location}`, tableBudget(manifest, t.refs)));
	}
	return lines;
}

/**
 * Each location's table and the models brought onto it: its props and tokens, what its objects
 * and fights turn props into, every character, and every enemy (the GM can bring any kind
 * anywhere). ponytail: a `{ prop, asset }` effect's asset isn't counted; walk the effects if one
 * ever gets large.
 */
function tablesOf(A: AdventureDef): { tables: Table[]; problems: string[] } {
	const tables: Table[] = [];
	const problems: string[] = [];
	const everywhere = [
		...Object.keys(A.characters),
		...Object.values(A.enemies).map((e) => e.model)
	].filter((id): id is string => !!id);
	for (const [location, def] of Object.entries(A.locations)) {
		const parsed = parseSceneFile(JSON.parse(JSON.stringify(def.scene())));
		if (!parsed.ok) {
			problems.push(`${location}: ${parsed.error}`);
			continue;
		}
		const scene = parsed.scene;
		const models = [
			...scene.props.map((p) => p.assetId),
			...scene.tokens.flatMap((t) => (t.model ? [t.model] : [])),
			...A.objects
				.filter((o) => o.location === location)
				.flatMap((o) =>
					Object.values(o.looks ?? {}).flatMap((l) => (l?.assetId ? [l.assetId] : []))
				),
			...Object.values(A.encounters)
				.filter((e) => e.location === location)
				.flatMap((e) => [
					...(e.remains ? [e.remains.asset] : []),
					...Object.values(e.phases?.all ?? {}).flatMap((p) => (p.hazard ? [p.hazard.asset] : []))
				]),
			...everywhere
		];
		tables.push({ location, scene, refs: { environment: scene.environment, models } });
	}
	return { tables, problems };
}

function checkAdventure(manifest: Manifest, A: AdventureDef): string[] {
	const { tables, problems } = tablesOf(A);
	const model = (id: string | undefined, kind: ModelKind, what: string) => {
		if (!id) problems.push(`${what} has no model`);
		else if (manifest.models[id]?.kind !== kind) problems.push(`${what}: no ${kind} model "${id}"`);
	};
	for (const { location, scene, refs } of tables) {
		if (!scene.environment || !(scene.environment in manifest.environments)) {
			problems.push(`${location}: no environment "${scene.environment}"`);
		}
		for (const p of scene.props) model(p.assetId, 'prop', `${location}: prop ${p.id}`);
		for (const t of scene.tokens) model(t.model, 'npc', `${location}: ${t.name}`);
		for (const over of overBudget(tableBudget(manifest, refs)))
			problems.push(`${location}: ${over}`);
	}
	for (const npc of Object.values(A.npcs)) model(npc.model, 'npc', npc.name);
	for (const id of Object.keys(A.characters)) model(id, 'character', id);
	for (const def of Object.values(A.enemies)) model(def.model, 'enemy', def.name);
	return problems;
}
