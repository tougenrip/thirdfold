// The cook (`npm run assets:cook`, docs/ASSETS.md "Cooking art"): the offline
// step from an artist's export to what `npm run assets` builds. It is slow
// (Basis encoding) and needs the pinned encoders, so it never runs per PR;
// the build only checks and hashes what it wrote.
//
//   art/<kind>/<id>/<id>.glb + meta.json   a model (a Blender export, PNG textures embedded; a CC0
//                                          bridge prop's put together by scripts/fetch-models.ts,
//                                          its colour maps recoloured through the meta's `ramp`)
//                                          → assets/models/<kind>/<id>.glb + <id>.meta.json
//   art/texture/<id>/<id>.png + meta.json  a texture → assets/textures/<id>.ktx2 + <id>.meta.json
//   art/surfaces/<id>/meta.json            a surface's CC0 set (scripts/fetch-surfaces.mjs), stylised
//                                          (cook-surfaces.ts) → assets/textures/surface-<id>-*.ktx2
//   assets/textures/<id>.json              a recipe: its 1K and 2K (the build renders its base)
//
// Every texture is cooked at a 512 px base into assets/ and, where the source is larger, at 1K
// and 2K as variants into variants/ (never committed), listed in assets/variants.lock.json
// (cook-variants.ts, variants.ts); a model with textures the same, as whole GLBs.
//
// A model is checked, cleaned (dedup, prune; one wearing a manifest material keeps its UVs), given MikkTSpace tangents where
// it has a normal map, welded, simplified into `<role>_lod1` and `_lod2`,
// quantised and meshopt-encoded, its textures encoded to KTX2
// (cook-textures.ts), and the result must pass checkGlb. assets/cook.lock.json
// records the tools, the settings and each entry's source and output hashes:
// an entry whose sources are unchanged is skipped, and `--check` compares
// hashes without encoding anything.

import { Logger, NodeIO, type Document, type Node, type Primitive } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
	cloneDocument,
	dedup,
	meshopt,
	prune,
	simplifyPrimitive,
	tangents,
	unweld,
	weld
} from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
	generateTangents,
	ready as mikktspace
} from 'three/examples/jsm/libs/mikktspace.module.js';
import {
	BASE_PX,
	LIMITS,
	MODEL_KINDS,
	limitClass,
	type ModelKind
} from '../../src/lib/assets/manifest';
import { SURFACE_SOURCES, cookSurface } from './cook-surfaces';
import { KTX2_SETTINGS, encodeTextures } from './cook-textures';
import {
	cookRecipe,
	cookTextureEntry,
	recipeIds,
	recipeSource,
	variantSizes,
	writeVariants,
	type Cooked
} from './cook-variants';
import {
	VARIANTS_DIR,
	VARIANT_LOCK,
	readVariantLock,
	staleVariants,
	variantLockText,
	type VariantLock
} from './variants';
import { checkGlb } from './glb';
import { EXTENSIONS, MESH_NAME } from './gltf-check';
import { readMeta } from './licence';
import { decodePng, encodePng } from './png';
import { recolour } from './stylise';
import { AssetError, isRecord, json, readJson } from './pipeline-files';
import { isModelKind } from './models';

/** What the cook does besides each asset's meta.json: in the lock, so changing it shows as drift. */
export const COOK_SETTINGS = {
	version: 2,
	/** Texture detail: every texture's base, and the variants a source large enough gets. */
	sizes: [512, 1024, 2048],
	/** Each level's share of the triangles, the simplifier's error limit and the screen size below which it is drawn. */
	lods: [
		{ ratio: 0.5, error: 0.05, screenSize: 0.25 },
		{ ratio: 0.15, error: 0.2, screenSize: 0.1 }
	],
	/** A role with fewer triangles gets no LODs. */
	lodFloor: 300,
	meshopt: 'medium',
	ktx2: KTX2_SETTINGS,
	/** The surface library's stylise step (#187): bump it when stylise.ts changes what it makes. */
	stylise: 1
} as const;

/** The packages whose versions change the cooked bytes. */
const TOOLS = ['@gltf-transform/functions', 'meshoptimizer', 'ktx2-encoder', 'three'];

export const LOCK_FILE = 'cook.lock.json';
const ROLE = /^(body|swing|accent|flame)$/;
const ATTRIBUTES = new Set(['POSITION', 'NORMAL', 'TANGENT', 'TEXCOORD_0', 'COLOR_0']);

interface LockEntry {
	sources: Record<string, string>;
	outputs: Record<string, string>;
}
export interface Lock {
	tools: Record<string, string>;
	settings: typeof COOK_SETTINGS;
	entries: Record<string, LockEntry>;
}

const sha256 = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
const folders = (dir: string) =>
	existsSync(dir)
		? readdirSync(dir, { withFileTypes: true })
				.filter((d) => d.isDirectory())
				.map((d) => d.name)
				.sort()
		: [];

export function toolVersions(): Record<string, string> {
	return Object.fromEntries(
		TOOLS.map((name) => {
			const pkg = readJson(path.join('node_modules', name, 'package.json'));
			return [name, isRecord(pkg) ? String(pkg.version) : '?'];
		})
	);
}

/** Every art entry, `<kind>/<id>`, with its source files' hashes. */
function sources(art: string): Map<string, Record<string, string>> {
	const found = new Map<string, Record<string, string>>();
	for (const kind of folders(art)) {
		if (kind !== 'texture' && kind !== 'surfaces' && !isModelKind(kind)) {
			throw new AssetError(
				path.join(art, kind),
				`art folders are texture, surfaces, ${MODEL_KINDS.join(', ')}`
			);
		}
		for (const id of folders(path.join(art, kind))) {
			const dir = path.join(art, kind, id);
			// A generated source (the bell's, scripts/make-bell-art.ts) is gitignored beside its
			// committed meta.json: without it the entry is kept elsewhere, like a missing folder.
			const main = kind === 'texture' ? `${id}.png` : `${id}.glb`;
			if (kind !== 'surfaces' && !existsSync(path.join(dir, main))) continue;
			// A surface's source set is pinned by its meta.json's hash: only that is committed.
			const files = readdirSync(dir)
				.filter((f) => kind !== 'surfaces' || SURFACE_SOURCES.includes(f))
				.sort();
			found.set(
				`${kind}/${id}`,
				Object.fromEntries(files.map((f) => [f, sha256(readFileSync(path.join(dir, f)))]))
			);
		}
	}
	return found;
}

/** Every entry: the art's, and `recipes/<id>` for the recipes in `assets`/textures. */
function allSources(art: string, assets: string): Map<string, Record<string, string>> {
	const found = sources(art);
	const dir = path.join(assets, 'textures');
	const names = existsSync(dir) ? readdirSync(dir).filter((n) => !n.startsWith('_')) : [];
	for (const id of recipeIds(names).sort()) found.set(`recipes/${id}`, recipeSource(dir, id));
	return found;
}

function readLock(assets: string): Lock | null {
	const file = path.join(assets, LOCK_FILE);
	return existsSync(file) ? (readJson(file) as Lock) : null;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** What `--check` finds wrong: sources, tools or settings changed since the cook, or outputs changed after it. */
export function checkCook(art: string, assets: string, variants = VARIANTS_DIR): string[] {
	const lock = readLock(assets);
	if (!lock) return [`${LOCK_FILE} is missing`];
	const problems: string[] = [];
	if (!same(lock.tools, toolVersions())) problems.push('the tools changed since the cook');
	if (!same(lock.settings, COOK_SETTINGS)) problems.push('the cook settings changed');
	// art/ may be kept elsewhere (#191): only what is here is compared.
	for (const [key, files] of allSources(art, assets)) {
		if (!same(lock.entries[key]?.sources, files))
			problems.push(`${key}: not cooked since it changed`);
	}
	for (const [key, entry] of Object.entries(lock.entries)) {
		for (const file of changed(assets, entry)) {
			problems.push(`${key}: ${file} is not what the cook wrote`);
		}
	}
	// Variants are compared only where they are here: they live in the asset store.
	return [...problems, ...staleVariants(variants, readVariantLock(assets))];
}

/** An entry's outputs that are missing or not what the cook wrote. */
function changed(assets: string, entry: LockEntry): string[] {
	return Object.entries(entry.outputs)
		.filter(([file, hash]) => {
			const out = path.join(assets, file);
			return !existsSync(out) || sha256(readFileSync(out)) !== hash;
		})
		.map(([file]) => file);
}

/** Cooks every art entry whose sources, tools or settings changed (all with `force`) and rewrites the lock. */
export async function cook(
	art: string,
	assets: string,
	force = false,
	variantDir = VARIANTS_DIR
): Promise<{ cooked: string[]; skipped: string[] }> {
	const old = readLock(assets);
	const tools = toolVersions();
	const fresh = !force && old && same(old.tools, tools) && same(old.settings, COOK_SETTINGS);
	// Entries whose art isn't here (kept elsewhere, #191) stay as they were.
	const lock: Lock = { tools, settings: COOK_SETTINGS, entries: { ...old?.entries } };
	const cooked: string[] = [];
	const skipped: string[] = [];
	const variants: VariantLock = readVariantLock(assets);
	for (const [key, files] of allSources(art, assets)) {
		const before = old?.entries[key];
		if (fresh && before && same(before.sources, files) && !changed(assets, before).length) {
			skipped.push(key);
			continue;
		}
		const [kind, id] = key.split('/');
		const { outputs, variants: made }: Cooked =
			kind === 'recipes'
				? cookRecipe(path.join(assets, 'textures'), id)
				: kind === 'texture'
					? await cookTextureEntry(path.join(art, key), id)
					: kind === 'surfaces'
						? await cookSurface(path.join(art, key), id)
						: await cookModel(path.join(art, key), kind as ModelKind, id);
		// This entry's variants replace what the lock had for its ids.
		for (const v of made) delete variants[v.kind][v.id];
		const records = writeVariants(variantDir, made);
		made.forEach((v, i) => (variants[v.kind][v.id] ??= []).push(records[i]));
		const hashes: Record<string, string> = {};
		for (const [file, data] of outputs) {
			const out = path.join(assets, file);
			mkdirSync(path.dirname(out), { recursive: true });
			writeFileSync(out, data);
			hashes[file] = sha256(data);
		}
		lock.entries[key] = { sources: files, outputs: hashes };
		cooked.push(key);
	}
	writeFileSync(path.join(assets, LOCK_FILE), json(lock));
	writeFileSync(path.join(assets, VARIANT_LOCK), variantLockText(variants));
	return { cooked, skipped };
}

// Warnings only: what the transforms skipped, not what they removed.
const QUIET = new Logger(Logger.Verbosity.WARN);
let io: Promise<NodeIO> | null = null;
const reader = () =>
	(io ??= Promise.all([MeshoptEncoder.ready, MeshoptSimplifier.ready, mikktspace]).then(() =>
		new NodeIO()
			.setLogger(QUIET)
			.registerExtensions(ALL_EXTENSIONS)
			.registerDependencies({ 'meshopt.encoder': MeshoptEncoder })
	));

/** The source's problems before any work: what Blender may export that a model may not hold. */
function sourceProblem(doc: Document): string | null {
	const root = doc.getRoot();
	for (const ext of root.listExtensionsUsed()) {
		if (!EXTENSIONS.has(ext.extensionName)) {
			return `extension ${ext.extensionName} is not allowed (untick it in the export)`;
		}
	}
	if (root.listSkins().length || root.listAnimations().length || root.listCameras().length) {
		return 'no skins, animations or cameras';
	}
	const meshNodes = root.listNodes().filter((n) => n.getMesh());
	if (!meshNodes.length) return 'no meshes';
	for (const node of meshNodes) {
		if (!MESH_NAME.test(node.getName())) {
			return `object "${node.getName()}" must be named body, swing, accent or flame (or body_pose1 to _pose3; <role>_lod1, _lod2)`;
		}
		for (const prim of node.getMesh()!.listPrimitives()) {
			if (prim.getMode() !== 4) return 'only triangles';
			if (prim.listTargets().length) return 'no shape keys';
			const position = prim.getAttribute('POSITION');
			if (!position) return 'a primitive without positions';
			const count = position.getCount();
			for (const semantic of prim.listSemantics()) {
				if (!ATTRIBUTES.has(semantic)) return `attribute ${semantic} is not allowed`;
				if (prim.getAttribute(semantic)!.getCount() !== count) {
					return 'attributes of different lengths';
				}
			}
			if (!(position.getArray() ?? []).every(Number.isFinite))
				return 'positions that are not numbers';
			const indices = Array.from(prim.getIndices()?.getArray() ?? [], Number);
			if (indices.length % 3 || indices.some((i) => i >= count)) return 'broken indices';
		}
	}
	return null;
}

/** A copy of `node`'s mesh simplified to `ratio`, on a node beside it named `<role>_lod<level>`. */
function addLod(
	doc: Document,
	node: Node,
	level: number,
	ratio: number,
	error: number,
	lockBorder: boolean
) {
	const name = `${node.getName()}_lod${level}`;
	const mesh = doc.createMesh(name);
	for (const prim of node.getMesh()!.listPrimitives()) {
		mesh.addPrimitive(
			simplifyPrimitive(prim.clone(), { simplifier: MeshoptSimplifier, ratio, error, lockBorder })
		);
	}
	const lod = doc
		.createNode(name)
		.setMesh(mesh)
		.setTranslation(node.getTranslation())
		.setRotation(node.getRotation())
		.setScale(node.getScale());
	const parent = node.getParentNode();
	if (parent) parent.addChild(lod);
	for (const scene of doc.getRoot().listScenes()) {
		if (scene.listChildren().includes(node)) scene.addChild(lod);
	}
	return lod;
}

const triangles = (prims: Primitive[]) =>
	prims.reduce(
		(sum, p) => sum + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION')!.getCount()) / 3,
		0
	);

async function cookModel(dir: string, kind: ModelKind, id: string): Promise<Cooked> {
	const meta = readMeta(dir);
	const source = path.join(dir, `${id}.glb`);
	if (!existsSync(source)) throw new AssetError(dir, `needs ${id}.glb`);
	const setPiece = meta.setPiece === true;
	if (setPiece && kind !== 'prop') throw new AssetError(dir, 'only a prop is a set piece');
	const limit = LIMITS[limitClass({ kind, setPiece })];
	const io = await reader();
	let doc: Document;
	try {
		doc = await io.readBinary(readFileSync(source));
	} catch (err) {
		throw new AssetError(source, `does not read: ${(err as Error).message}`);
	}
	doc.setLogger(QUIET);
	const problem = sourceProblem(doc);
	if (problem) throw new AssetError(source, problem);
	const root = doc.getRoot();

	// Provenance lives in the manifest: no extras, no copyright or generator from the tool.
	for (const p of [
		root,
		...root.listNodes(),
		...root.listMeshes(),
		...root.listMeshes().flatMap((m) => m.listPrimitives()),
		...root.listMaterials(),
		...root.listTextures(),
		...root.listScenes(),
		...root.listAccessors()
	]) {
		p.setExtras({});
	}
	root.getAsset().generator = 'thirdfold cook';
	delete root.getAsset().copyright;
	delete root.getAsset().extras;
	// Blender names mesh data apart from its object: the mesh takes its node's role.
	for (const node of root.listNodes()) node.getMesh()?.setName(node.getName());
	// A CC0 bridge prop's colour maps go through its palette ramp (#262).
	if (meta.ramp) {
		const colour = new Set(root.listMaterials().flatMap((m) => m.getBaseColorTexture() ?? []));
		for (const texture of colour) {
			try {
				const { width, height, data } = recolour(
					decodePng(texture.getImage()!),
					meta.ramp,
					meta.detail ?? 0.25
				);
				texture.setImage(encodePng(width, height, data));
			} catch (err) {
				throw new AssetError(
					source,
					`recolouring "${texture.getName()}": ${(err as Error).message}`
				);
			}
		}
	}

	// A piece that wears a manifest material (a kit's trim sheet, M70) keeps its UVs: prune would
	// drop them, having no texture of its own to sample them.
	const pruned = () => prune({ keepAttributes: meta.materials !== undefined });
	await doc.transform(dedup(), pruned());
	if (root.listMaterials().some((m) => m.getNormalTexture())) {
		await doc.transform(unweld(), tangents({ generateTangents, overwrite: true }));
	}
	await doc.transform(weld());

	// LODs, only for roles with triangles to spare and none made by hand, each coarser than the last.
	const names = root.listNodes().map((n) => n.getName());
	for (const node of root.listNodes().filter((n) => n.getMesh() && ROLE.test(n.getName()))) {
		if (names.includes(`${node.getName()}_lod1`)) continue;
		let previous = triangles(node.getMesh()!.listPrimitives());
		if (previous < COOK_SETTINGS.lodFloor) continue;
		for (const [i, defaults] of COOK_SETTINGS.lods.entries()) {
			const want = { ...defaults, ...meta.lods?.[i] };
			const lod = addLod(doc, node, i + 1, want.ratio, want.error, meta.lockBorder === true);
			const count = triangles(lod.getMesh()!.listPrimitives());
			if (count >= previous) {
				lod.getMesh()!.dispose();
				lod.dispose();
				break;
			}
			previous = count;
		}
	}
	await doc.transform(pruned(), meshopt({ encoder: MeshoptEncoder, level: COOK_SETTINGS.meshopt }));

	// Textures to KTX2 by the slots they fill, colour ETC1S, data UASTC: at the 512 px base, and as
	// whole GLBs with 1K and 2K textures where the source's are that large (texture detail).
	const maxPx = Math.min(meta.textureSize ?? limit.px, limit.px);
	const sourcePx = Math.max(
		0,
		...root
			.listTextures()
			.map((t) => (t.getMimeType() === 'image/png' ? Math.max(...(t.getSize() ?? [0])) : 0))
	);
	const sizes = [Math.min(BASE_PX, maxPx), ...variantSizes(sourcePx, maxPx)];
	const cooked: Cooked = { outputs: new Map(), variants: [] };
	for (const [i, px] of sizes.entries()) {
		const copy = i === sizes.length - 1 ? doc : cloneDocument(doc);
		await encodeTextures(copy, px, source);
		const glb = await io.writeBinary(copy);
		const checked = await checkGlb(glb, limit);
		if (!checked.ok) throw new AssetError(source, `cooked at ${px} px, but ${checked.error}`);
		if (i > 0) {
			const size = px as 1024 | 2048;
			cooked.variants.push({
				kind: 'models',
				id,
				size,
				ext: 'glb',
				data: glb,
				gpuBytes: checked.info.gpuBytes
			});
			continue;
		}
		const screenSizes = checked.info.lods.map(
			(_, i) => ({ ...COOK_SETTINGS.lods[i], ...meta.lods?.[i] }).screenSize
		);
		const out = {
			provenance: meta.provenance,
			...(meta.swing !== undefined ? { swing: meta.swing } : {}),
			...(meta.poses !== undefined ? { poses: meta.poses } : {}),
			...(setPiece ? { setPiece: true } : {}),
			...(meta.pack !== undefined ? { pack: meta.pack } : {}),
			...(meta.materials !== undefined ? { materials: meta.materials } : {}),
			...(screenSizes.length ? { screenSizes } : {})
		};
		cooked.outputs.set(`models/${kind}/${id}.glb`, glb);
		cooked.outputs.set(`models/${kind}/${id}.meta.json`, Buffer.from(json(out)));
	}
	return cooked;
}

// The command: `npm run assets:cook` cooks what changed; `-- --check` only compares hashes;
// `-- --force` cooks everything again.
if (process.argv[1]?.endsWith('cook.ts')) {
	try {
		if (process.argv.includes('--check')) {
			const problems = checkCook('art', 'assets');
			if (problems.length) {
				console.error(
					`The cook is out of date; run \`npm run assets:cook\`:\n  ${problems.join('\n  ')}`
				);
				process.exit(1);
			}
			console.log('The cooked assets match assets/cook.lock.json.');
		} else {
			const { cooked, skipped } = await cook('art', 'assets', process.argv.includes('--force'));
			console.log(
				`Cooked ${cooked.length} (${cooked.join(', ') || 'none'}), ${skipped.length} unchanged.`
			);
		}
	} catch (err) {
		if (err instanceof AssetError) {
			console.error(err.message);
			process.exit(1);
		}
		throw err;
	}
}
