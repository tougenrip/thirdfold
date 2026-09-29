import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
	ASSET_FILE_PATTERN,
	LIMITS,
	isFigureKind,
	type LimitClass,
	type ModelKind
} from '../../src/lib/assets/manifest';
import { parseManifest } from '../../src/lib/assets/manifest-parse';
import { buildAssets, type BuiltAssets } from './pipeline';
import { emitter } from './pipeline-files';
import { buildModels } from './pipeline-models';
import { buildTextures } from './pipeline-textures';
import { writeGlb } from './glb';
import { bakeModel, readModelSource } from './models';
import { encodePng } from './png';

// Building every asset renders the 54 colour-grade strips: a few seconds.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

let built: BuiltAssets;
/** The built manifest as the client fetches it. */
let raw: Record<string, Record<string, Record<string, unknown>>>;
beforeAll(async () => {
	built = await buildAssets('assets');
	raw = JSON.parse(JSON.stringify(built.manifest));
});

const parse = (change: (m: typeof raw) => void) => {
	const copy = structuredClone(raw);
	change(copy);
	return parseManifest(copy);
};

describe('manifest v2', () => {
	it('is what the pipeline builds, read back whole; a v1 manifest is refused', () => {
		expect(parseManifest(raw)).toEqual({ ok: true, manifest: built.manifest });
		expect(parse((m) => ((m as Record<string, unknown>).version = 1))).toMatchObject({
			ok: false,
			error: 'unknown version 1'
		});
	});

	it('names files by kind, id, hash prefix and type, KTX2 among them', () => {
		expect(ASSET_FILE_PATTERN.test('textures/stone.0123abcd.ktx2')).toBe(true);
		expect(ASSET_FILE_PATTERN.test('textures/stone.0123abcd.jpg')).toBe(false);
	});

	it('lists every file with the SHA-256 of its bytes, whose prefix is in its name', () => {
		const m = built.manifest;
		const entries = [
			...Object.values(m.models),
			...Object.values(m.textures),
			...Object.values(m.audio)
		];
		expect(entries).toHaveLength(built.files.size);
		for (const e of entries) {
			expect(e.sha256).toBe(createHash('sha256').update(built.files.get(e.file)!).digest('hex'));
		}
		expect(parse((m) => (m.models.table.sha256 = '0'.repeat(64)))).toMatchObject({ ok: false });
		expect(parse((m) => delete m.textures.grass.sha256)).toMatchObject({ ok: false });
	});

	it('drops fields it does not know, and refuses kinds, formats and usages it does not know', () => {
		const known = parse((m) => {
			(m as Record<string, unknown>).later = { anything: true };
			m.models.table.shine = 3;
			m.textures.grass.hdr = true;
		});
		expect(known.ok && known.manifest).toEqual(built.manifest);
		expect(parse((m) => (m.models.table.kind = 'vehicle'))).toMatchObject({ ok: false });
		expect(parse((m) => (m.textures.grass.format = 'jpg'))).toMatchObject({ ok: false });
		expect(parse((m) => (m.textures.grass.usage = 'glow'))).toMatchObject({ ok: false });
		// Only a prop is a set piece; set pieces are a class, not a kind.
		expect(parse((m) => (m.models.warden.setPiece = true))).toMatchObject({ ok: false });
		expect(parse((m) => (m.models.table.setPiece = 'yes'))).toMatchObject({ ok: false });
	});

	it('holds each usage to its colour space', () => {
		expect(built.manifest.textures['paint-normal']).toMatchObject({
			usage: 'normal',
			colorSpace: 'linear'
		});
		expect(built.manifest.textures['grade-village-day-aces']).toMatchObject({
			usage: 'lut',
			colorSpace: 'srgb'
		});
		expect(parse((m) => (m.textures['paint-normal'].colorSpace = 'srgb'))).toMatchObject({
			ok: false
		});
		expect(
			parse((m) => (m.textures['grade-village-day-aces'].colorSpace = 'linear'))
		).toMatchObject({ ok: false });
		// A material's map is colour, and its normal map a normal map.
		expect(parse((m) => (m.materials.flesh.map = 'paint-normal'))).toMatchObject({ ok: false });
		expect(parse((m) => (m.materials.flesh.normal = 'paint-normal'))).toMatchObject({ ok: true });
		expect(parse((m) => (m.materials.flesh.normal = 'grass'))).toMatchObject({ ok: false });
	});

	it('reads the fields later work fills: LODs, credits, packs, previews, surfaces, decoders', () => {
		const table = raw.models.table;
		const file = (f: string) => ({ file: f, bytes: 10, sha256: 'abcdef01' + '0'.repeat(56) });
		const filled = parse((m) => {
			(m as Record<string, unknown>).packs = { core: { bytes: 10, gpuBytes: 20 } };
			Object.assign(m.models.table, {
				pack: 'core',
				lods: [
					{ triangles: 6, screenSize: 0.25 },
					{ triangles: 2, screenSize: 0.1 }
				],
				credit: { license: 'CC0-1.0', author: 'ambientCG', source: 'https://ambientcg.com/x' },
				preview: file('previews/table.abcdef01.glb'),
				thumbnail: file('thumbs/table.abcdef01.png'),
				materials: ['flesh']
			});
			(m as Record<string, unknown>).surfaces = {
				stone: { albedo: 'grass', normal: 'paint-normal', orm: 'lens-dirt' }
			};
			Object.assign(m.textures['lens-dirt'], { usage: 'orm', colorSpace: 'linear' });
			m.environments.village.surfaces = { floors: ['stone'], walls: [] };
			(m as Record<string, unknown>).decoders = {
				basis: { dir: 'decoders/basis-0123abcd', bytes: 500_000 }
			};
		});
		expect(filled).toMatchObject({ ok: true });
		expect(filled.ok && filled.manifest.models.table).toMatchObject({
			pack: 'core',
			lods: [{ triangles: 6 }, { triangles: 2 }],
			credit: { license: 'CC0-1.0' }
		});
		const bad = (change: Record<string, unknown>) =>
			parse((m) => Object.assign(m.models.table, change));
		// Each level coarser and smaller than the one before.
		expect(bad({ lods: [{ triangles: table.triangles, screenSize: 0.5 }] })).toMatchObject({
			ok: false
		});
		expect(
			bad({
				lods: [
					{ triangles: 6, screenSize: 0.1 },
					{ triangles: 2, screenSize: 0.2 }
				]
			})
		).toMatchObject({ ok: false });
		expect(bad({ pack: 'nowhere' })).toMatchObject({ ok: false });
		expect(bad({ credit: { license: 'WTFPL', author: 'x' } })).toMatchObject({ ok: false });
		expect(bad({ credit: { license: 'CC0-1.0', author: 'x', source: 'http://x' } })).toMatchObject({
			ok: false
		});
		expect(bad({ materials: ['nothing'] })).toMatchObject({ ok: false });
		// Names that are properties of every object are not ids a record holds.
		expect(bad({ pack: 'constructor' })).toMatchObject({ ok: false });
		expect(bad({ materials: ['toString'] })).toMatchObject({ ok: false });
		expect(
			parse((m) => (m.environments.village.surfaces = { floors: ['x'], walls: [] }))
		).toMatchObject({ ok: false });
		expect(
			parse((m) => ((m as Record<string, unknown>).decoders = { basis: { dir: '../x', bytes: 1 } }))
		).toMatchObject({ ok: false });
		// A missing rim wears the floor's look.
		expect(parse((m) => delete m.environments.village.table)).toMatchObject({ ok: true });
	});

	it('draws tokens from the same figures as before: characters, NPCs and enemies', () => {
		const models = Object.entries(built.manifest.models);
		expect(models.filter(([, e]) => isFigureKind(e.kind)).map(([id]) => id)).toEqual(
			models.filter(([, e]) => e.kind !== 'prop').map(([id]) => id)
		);
	});
});

/** A model of each class: its kind, and whether it is a set piece. */
const CLASSES: [LimitClass, ModelKind, boolean][] = [
	['kit', 'kit', false],
	['prop', 'decor', false],
	['foliage', 'foliage', false],
	['fx', 'fx', false],
	['figure', 'npc', false],
	['setPiece', 'prop', true]
];

describe('the limits per class, in the parser', () => {
	it.each(CLASSES)('%s: triangles, bytes and GPU bytes', (limitClass, kind, setPiece) => {
		const limit = LIMITS[limitClass];
		const model = (change: Record<string, unknown>) =>
			parse((m) => {
				Object.assign(m.models.table, { kind, gpuBytes: 100 }, change);
				if (setPiece) m.models.table.setPiece = true;
			});
		expect(
			model({ triangles: limit.triangles, bytes: limit.bytes, gpuBytes: limit.gpuBytes })
		).toMatchObject({ ok: true });
		expect(model({ triangles: limit.triangles + 1 })).toMatchObject({ ok: false });
		expect(model({ bytes: limit.bytes + 1 })).toMatchObject({ ok: false });
		expect(model({ gpuBytes: limit.gpuBytes + 1 })).toMatchObject({ ok: false });
	});

	it.each(['texture', 'sky'] as const)('%s: size, bytes and GPU bytes', (limitClass) => {
		const limit = LIMITS[limitClass];
		const texture = (change: Record<string, unknown>) =>
			parse((m) => {
				// The lens dirt: a texture no material wears, so its usage may change.
				const dirt = m.textures['lens-dirt'];
				if (limitClass === 'sky') Object.assign(dirt, { usage: 'sky', colorSpace: 'srgb' });
				Object.assign(dirt, change);
			});
		expect(
			texture({ width: limit.px, bytes: limit.bytes, gpuBytes: limit.gpuBytes })
		).toMatchObject({ ok: true });
		expect(texture({ width: limit.px + 1 })).toMatchObject({ ok: false });
		expect(texture({ bytes: limit.bytes + 1 })).toMatchObject({ ok: false });
		expect(texture({ gpuBytes: limit.gpuBytes + 1 })).toMatchObject({ ok: false });
	});
});

describe('the limits per class, in the pipeline', () => {
	let dir: string;
	afterEach(() => rmSync(dir, { recursive: true, force: true }));
	const folder = (...parts: string[]) => {
		const at = path.join(dir, ...parts);
		mkdirSync(at, { recursive: true });
		return at;
	};

	/** A part list of `n` spheres, 352 triangles each. */
	const spheres = (n: number, setPiece: boolean) => ({
		parts: Array.from({ length: n }, (_, i) => ({
			shape: 'sphere',
			size: [1, 1, 1],
			at: [i % 20, 0, Math.floor(i / 20)],
			color: '#808080'
		})),
		...(setPiece ? { setPiece: true } : {})
	});

	it.each(CLASSES)(
		'%s: a model over its triangles or bytes is refused',
		async (cls, kind, setPiece) => {
			dir = mkdtempSync(path.join(tmpdir(), 'thirdfold-limits-'));
			const limit = LIMITS[cls];
			const at = folder('models', kind);
			const build = () => buildModels(dir, emitter(new Map()), {});
			const under = Math.floor(limit.triangles / 352);
			writeFileSync(path.join(at, 'm.json'), JSON.stringify(spheres(under, setPiece)));
			expect((await build()).m).toMatchObject({ kind, triangles: under * 352 });
			writeFileSync(path.join(at, 'm.json'), JSON.stringify(spheres(under + 1, setPiece)));
			await expect(build()).rejects.toThrow(
				new RegExp(`triangles is more than ${limit.triangles}`)
			);
			// A model made elsewhere, padded past the class's size (its binary chunk grown with zeros).
			rmSync(path.join(at, 'm.json'));
			const glb = writeGlb(bakeModel(readModelSource(spheres(1, false), new Set()), () => '#fff'));
			const json = glb.readUInt32LE(12);
			const pad = limit.bytes - glb.length + 4;
			const padded = Buffer.concat([glb, Buffer.alloc(pad)]);
			padded.writeUInt32LE(padded.length, 8);
			padded.writeUInt32LE(glb.readUInt32LE(20 + json) + pad, 20 + json);
			writeFileSync(path.join(at, 'm.glb'), padded);
			if (setPiece) writeFileSync(path.join(at, 'm.meta.json'), '{ "setPiece": true }');
			await expect(build()).rejects.toThrow(/m\.glb: file too large/);
		}
	);

	it.each(['texture', 'sky'] as const)('%s: a texture over its size or bytes is refused', (cls) => {
		dir = mkdtempSync(path.join(tmpdir(), 'thirdfold-limits-'));
		const limit = LIMITS[cls];
		const at = folder('textures');
		if (cls === 'sky') writeFileSync(path.join(at, 't.meta.json'), '{ "usage": "sky" }');
		const build = () => buildTextures(dir, emitter(new Map()));
		const png = (w: number, h: number, pixels = new Uint8Array(w * h * 4)) =>
			writeFileSync(path.join(at, 't.png'), encodePng(w, h, pixels));
		png(limit.px, 1);
		expect(build().t).toMatchObject({ width: limit.px, usage: cls === 'sky' ? 'sky' : 'albedo' });
		png(limit.px + 1, 1);
		expect(build).toThrow(new RegExp(`larger than ${limit.px} pixels`));
		// Noise does not compress: a square just big enough to pass the byte limit.
		const side = Math.ceil(Math.sqrt(limit.bytes / 4)) + 8;
		png(side, side, randomBytes(side * side * 4));
		expect(build).toThrow(/t\.png: file too large/);
	});

	it('refuses a 4096 px sky as PNG: at that size a sky fits only as KTX2', () => {
		dir = mkdtempSync(path.join(tmpdir(), 'thirdfold-limits-'));
		const at = folder('textures');
		writeFileSync(path.join(at, 'sky.meta.json'), '{ "usage": "sky" }');
		writeFileSync(path.join(at, 'sky.png'), encodePng(4096, 4096, new Uint8Array(4096 * 4096 * 4)));
		expect(() => buildTextures(dir, emitter(new Map()))).toThrow(/sky\.png: too large on the GPU/);
	});

	it('refuses an <id>.meta.json with nothing to describe, or beside a .json source', async () => {
		dir = mkdtempSync(path.join(tmpdir(), 'thirdfold-meta-'));
		const textures = folder('textures');
		const buildT = () => buildTextures(dir, emitter(new Map()));
		writeFileSync(path.join(textures, 't.meta.json'), '{ "usage": "sky" }');
		expect(buildT).toThrow(/t\.meta\.json: describes an <id>\.png that is not there/);
		writeFileSync(
			path.join(textures, 't.json'),
			JSON.stringify({ recipe: 'noise', size: 16, colors: ['#000000', '#ffffff'], seed: 1 })
		);
		expect(buildT).toThrow(/t\.meta\.json: a \.json source says this itself/);
		const props = folder('models', 'prop');
		const buildM = () => buildModels(dir, emitter(new Map()), {});
		writeFileSync(path.join(props, 'm.meta.json'), '{ "setPiece": true }');
		await expect(buildM()).rejects.toThrow(
			/m\.meta\.json: describes an <id>\.glb that is not there/
		);
		writeFileSync(path.join(props, 'm.json'), JSON.stringify(spheres(1, false)));
		await expect(buildM()).rejects.toThrow(/m\.meta\.json: a \.json source says this itself/);
	});
});
