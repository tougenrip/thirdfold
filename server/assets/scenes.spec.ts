import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	EMPTY_MANIFEST,
	type Manifest,
	type ModelEntry,
	type TextureEntry
} from '../../src/lib/assets/manifest';
import { parseManifest } from '../../src/lib/assets/manifest-parse';
import { parseWorldPatch } from '../../src/lib/game/world';
import {
	checkScenes,
	overBudget,
	SURFACE_FLOORS,
	TABLE_BUDGETS,
	tableBudget,
	worldPatches
} from './scenes';

const MB = 1024 * 1024;
const credit = { license: 'LicenseRef-thirdfold-original', author: 'us' } as const;

const texture = (bytes: number, gpuBytes: number, side = 512, format: 'png' | 'ktx2' = 'png') =>
	({
		file: `textures/t.00000000.${format}`,
		bytes,
		sha256: '0'.repeat(64),
		format,
		usage: 'albedo',
		colorSpace: 'srgb',
		width: side,
		height: side,
		layers: 1,
		levels: 1,
		gpuBytes,
		credit
	}) satisfies TextureEntry;

const model = (bytes: number, gpuBytes: number, extra: Partial<ModelEntry> = {}): ModelEntry => ({
	file: 'models/m.00000000.glb',
	bytes,
	sha256: '0'.repeat(64),
	kind: 'prop',
	triangles: 12,
	bounds: { min: [0, 0, 0], max: [1, 1, 1] },
	gpuBytes,
	credit,
	...extra
});

/** A place whose floor and ground share one texture, and whose walls have their own. */
function fake(): Manifest {
	return {
		...EMPTY_MANIFEST,
		textures: { stone: texture(100, 1000), plaster: texture(10, 100) },
		materials: {
			floor: { color: '#888888', roughness: 1, metalness: 0, map: 'stone' },
			ground: { color: '#777777', roughness: 1, metalness: 0, map: 'stone' },
			walls: { color: '#eeeeee', roughness: 1, metalness: 0, map: 'plaster' }
		},
		environments: {
			yard: { name: 'Yard', surface: 'floor', ground: 'ground', walls: 'walls' }
		},
		models: { crate: model(5, 50), barrel: model(7, 70) }
	};
}

describe('tableBudget', () => {
	it('counts a file shared by two materials, or placed twice, once', () => {
		const cost = tableBudget(fake(), { environment: 'yard', models: ['crate', 'crate', 'barrel'] });
		expect(cost.download.high).toBe(100 + 10 + 5 + 7);
		expect(cost.gpu.high).toBe(1000 + 100 + 50 + 70);
	});

	it('counts the transcoder once when any file is KTX2, and not at all without', () => {
		const m = fake();
		m.decoders = { basis: { dir: 'basis', bytes: 1000 } };
		expect(tableBudget(m, { environment: 'yard', models: [] }).download.low).toBe(110);
		m.textures.stone = texture(100, 1000, 512, 'ktx2');
		m.textures.plaster = texture(10, 100, 512, 'ktx2');
		expect(tableBudget(m, { environment: 'yard', models: [] }).download.low).toBe(110 + 1000);
		m.textures.stone = texture(100, 1000);
		m.textures.plaster = texture(10, 100);
		m.models.crate = model(5, 50, { cooked: true });
		expect(tableBudget(m, { environment: null, models: ['crate'] }).download.low).toBe(5 + 1000);
	});

	it('counts each texture detail: a variant after its base, the base where it has none', () => {
		const m = fake();
		m.textures.stone.variants = [
			{ ...texture(400, 4000), size: 1024 },
			{ ...texture(1600, 16000), size: 2048 }
		];
		m.models.crate = model(5, 50, { variants: [{ ...model(20, 500), size: 1024 }] });
		const cost = tableBudget(m, { environment: 'yard', models: ['crate'] });
		expect(cost.download).toEqual({ low: 115, medium: 115 + 400 + 20, high: 115 + 1600 + 20 });
		expect(cost.gpu).toEqual({ low: 1150, medium: 4000 + 100 + 500, high: 16000 + 100 + 500 });
		expect(cost.mobile).toBe(1150); // a phone starts on low
	});

	it('counts KTX2 at RGBA8 on mobile, the transcoder’s fallback, and reports a table it puts over', () => {
		const m = fake();
		m.textures.stone = texture(100, 1000, 512, 'ktx2');
		m.models.crate = model(5, 50, { cooked: true });
		const cost = tableBudget(m, { environment: 'yard', models: ['crate', 'barrel'] });
		expect(cost.gpu.high).toBe(1000 + 100 + 50 + 70);
		expect(cost.mobile).toBe(4000 + 100 + 200 + 70);
		m.textures.stone = texture(100, 25 * MB, 512, 'ktx2');
		expect(overBudget(tableBudget(m, { environment: 'yard', models: [] }))).toEqual([
			'100.0 MB GPU over the mobile 80.0 MB budget'
		]);
	});
});

const flat = (download: number, gpu: number) => ({
	download: { low: download, medium: download, high: download },
	gpu: { low: gpu, medium: gpu, high: gpu }
});

describe('the budgets', () => {
	it('name the number and the budget a table goes over, desktop at medium and mobile at low', () => {
		expect(overBudget({ ...flat(5 * MB, 70 * MB), mobile: 70 * MB })).toEqual([]);
		expect(overBudget({ ...flat(16.2 * MB, 90 * MB), mobile: 81 * MB })).toEqual([
			'16.2 MB download over the desktop 15.0 MB budget',
			'16.2 MB download over the mobile 6.0 MB budget',
			'81.0 MB GPU over the mobile 80.0 MB budget'
		]);
		const high = flat(5 * MB, 70 * MB);
		high.gpu.high = 200 * MB; // reported, not held
		expect(overBudget({ ...high, mobile: 0 })).toEqual([]);
		high.gpu.medium = 170 * MB;
		expect(overBudget({ ...high, mobile: 0 })).toEqual([
			'170.0 MB GPU over the desktop 160.0 MB budget'
		]);
		expect(TABLE_BUDGETS.desktop.gpu).toBe(160 * MB);
	});
});

describe('checkScenes', () => {
	const shipped = parseManifest(JSON.parse(readFileSync('static/assets/manifest.json', 'utf8')));
	if (!shipped.ok) throw new Error(shipped.error);

	it('passes every built-in table and the example on the shipped manifest', () => {
		expect(checkScenes(shipped.manifest)).toEqual([]);
	});

	it("fails the builder's example without its villager", () => {
		const m = structuredClone(shipped.manifest);
		delete m.models.villager;
		expect(checkScenes(m).filter((p) => p.startsWith('example: '))).toContainEqual(
			expect.stringContaining('no npc model "villager"')
		);
	});

	it('gives every environment a surface for each floor a GM can paint (#187)', () => {
		for (const env of Object.values(shipped.manifest.environments))
			expect(env.surfaces?.floors).toEqual(expect.arrayContaining(SURFACE_FLOORS));
		const m = structuredClone(shipped.manifest);
		m.environments.village.surfaces!.floors = ['stone'];
		expect(checkScenes(m)).toContainEqual('environment village: no surface for the wood floor');
	});

	it("finds every world effect's look, wherever it sits, for its ids' syntax", () => {
		const def = { a: [{ does: [{ world: { grade: { preset: 'Not an id' } } }] }], scene: () => 1 };
		const [patch] = worldPatches(def);
		expect(patch).toEqual({ grade: { preset: 'Not an id' } });
		expect(parseWorldPatch(patch)).toBeNull();
	});

	it('fails a table over budget, naming the adventure, location and number', () => {
		const m = structuredClone(shipped.manifest);
		m.models.villager = { ...m.models.villager, bytes: 20 * MB };
		const problems = checkScenes(m);
		expect(problems).toContainEqual(
			expect.stringMatching(/^example: \w+: \d+\.\d MB download over the desktop 15\.0 MB budget$/)
		);
	});
});
