import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { LIMITS } from '../../src/lib/assets/manifest';
import { parseManifest } from '../../src/lib/assets/manifest-parse';
import { audioInfo, encodeWav, renderBell } from './audio';
import { checkGlb, writeGlb } from './glb';
import { bakeModel, readModelSource } from './models';
import { buildAssets, staleAssets, writeAssets, type BuiltAssets } from './pipeline';
import { encodePng, pngSize } from './png';
import { checkScenes } from './scenes';
import { LOCK_FILE, lockOf, lockText } from './store';
import { NEUTRAL, readGrades, renderGrade, stripProblem } from './grades';
import { readTextureSource, renderTexture } from './textures';

// Several tests build every asset, the 54 colour-grade strips among them: a few seconds each.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

let built: BuiltAssets;
beforeAll(async () => {
	built = await buildAssets('assets');
});

describe('The adventures’ assets', () => {
	it('are built and committed: static/assets is exactly what assets/ builds', () => {
		// Run `npm run assets` after changing anything in assets/.
		expect(staleAssets(path.join('static', 'assets'), built)).toEqual([]);
	});

	it('are locked: assets/assets.lock.json is every hosted file’s SHA-256', () => {
		expect(readFileSync(LOCK_FILE, 'utf8')).toBe(lockText(lockOf(built.files)));
	});

	it('cover every table, figure and prop the story uses', () => {
		expect(checkScenes(built.manifest)).toEqual([]);
		const kinds = Object.values(built.manifest.models).map((m) => m.kind);
		for (const kind of ['prop', 'character', 'npc', 'enemy'] as const) {
			expect(kinds).toContain(kind);
		}
		expect(Object.keys(built.manifest.environments).sort()).toEqual([
			'cavern',
			'ghost-town',
			'living-cave',
			'railcar',
			'stone-halls',
			'village'
		]);
		expect(Object.keys(built.manifest.audio).sort()).toEqual(['bell-great', 'bell-hand']);
	});

	it('build the same bytes every time, named by their content', async () => {
		const again = await buildAssets('assets');
		expect([...again.files.keys()]).toEqual([...built.files.keys()]);
		for (const [file, data] of again.files) expect(data.equals(built.files.get(file)!)).toBe(true);
		for (const file of built.files.keys()) {
			expect(file).toMatch(
				/^((models|previews|textures|audio|thumbs)\/[a-z0-9-]+\.[0-9a-f]{8}\.(glb|png|ktx2|wav)|decoders\/basis-[0-9a-f]{8}\/basis_transcoder\.(js|wasm))$/
			);
		}
	});

	it('ship three’s KTX2 transcoder in a folder named by its hash, and replace an old one', () => {
		const { dir, bytes } = built.manifest.decoders!.basis;
		expect(built.files.has(`${dir}/basis_transcoder.js`)).toBe(true);
		expect(built.files.has(`${dir}/basis_transcoder.wasm`)).toBe(true);
		expect(bytes).toBe(
			built.files.get(`${dir}/basis_transcoder.js`)!.length +
				built.files.get(`${dir}/basis_transcoder.wasm`)!.length
		);
		const out = mkdtempSync(path.join(tmpdir(), 'thirdfold-out-'));
		try {
			const old = path.join(out, 'decoders', 'basis-00000000');
			mkdirSync(old, { recursive: true });
			writeFileSync(path.join(old, 'basis_transcoder.js'), '');
			expect(staleAssets(out, built)).toContain(
				'decoders/basis-00000000/basis_transcoder.js is no longer built'
			);
			writeAssets(out, built);
			expect(existsSync(old)).toBe(false);
			expect(staleAssets(out, built)).toEqual([]);
		} finally {
			rmSync(out, { recursive: true });
		}
	});

	it('bake props into one draw per model part group, with the swing and its pivot kept', async () => {
		const bell = built.manifest.models['belfry-bell'];
		expect(bell).toMatchObject({ kind: 'prop', swing: { pivot: 2.55, throw: 0.5 } });
		const checked = await checkGlb(built.files.get(bell.file)!);
		expect(checked.ok && checked.info.meshes).toEqual(['body', 'swing']);
		const warden = built.manifest.models.warden;
		const figure = await checkGlb(built.files.get(warden.file)!);
		expect(figure.ok && figure.info.meshes).toEqual(['body', 'accent']);
	});

	it('take the cooked great bell (the pilot, #196) with its LODs, swing, credit and preview', async () => {
		const bell = built.manifest.models['great-bell'];
		expect(bell).toMatchObject({
			cooked: true,
			setPiece: true,
			pack: 'cavern',
			swing: { pivot: 3.85, throw: 0.3 },
			credit: { license: 'LicenseRef-thirdfold-original' },
			preview: { file: expect.stringMatching(/^previews\/great-bell\./) }
		});
		expect(bell.lods?.map((l) => l.screenSize)).toEqual([0.25, 0.1]);
		const checked = await checkGlb(built.files.get(bell.file)!, LIMITS.setPiece);
		expect(checked.ok && checked.info.meshes).toEqual(
			expect.arrayContaining(['body', 'swing', 'body_lod1', 'swing_lod2'])
		);
	});

	it('load in three.js as plain geometry, colours and all', async () => {
		const file = built.files.get(built.manifest.models.table.file)!;
		const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
		const gltf = await new GLTFLoader().parseAsync(buffer as ArrayBuffer, '');
		const meshes: THREE.Mesh[] = [];
		gltf.scene.traverse((o) => {
			if (o instanceof THREE.Mesh) meshes.push(o);
		});
		expect(meshes.map((m) => m.name)).toEqual(['body']);
		const geometry = meshes[0].geometry as THREE.BufferGeometry;
		expect(geometry.getAttribute('color').itemSize).toBe(4);
		expect(geometry.getAttribute('position').count).toBeGreaterThan(0);
	});
});

describe('the manifest', () => {
	it('is valid, and refuses files outside the asset folders or unknown references', () => {
		const raw = JSON.parse(JSON.stringify(built.manifest));
		expect(parseManifest(raw).ok).toBe(true);
		const bad = (change: (m: typeof raw) => void) => {
			const copy = structuredClone(raw);
			change(copy);
			return parseManifest(copy);
		};
		expect(bad((m) => (m.models.table.file = '../../server/index.ts'))).toMatchObject({
			ok: false
		});
		expect(bad((m) => (m.models.table.file = 'https://example.com/x.glb'))).toMatchObject({
			ok: false
		});
		expect(bad((m) => (m.models.table.kind = 'script'))).toMatchObject({ ok: false });
		expect(bad((m) => (m.materials.flesh.map = 'nope'))).toMatchObject({ ok: false });
		expect(bad((m) => (m.environments.village.surface = 'nope'))).toMatchObject({ ok: false });
		expect(bad((m) => (m.models['<b>'] = m.models.table))).toMatchObject({ ok: false });
		expect(bad((m) => (m.textures.grass.file = 'textures/grass.00000000.glb'))).toMatchObject({
			ok: false
		});
	});
});

describe('models', () => {
	const cube = { parts: [{ shape: 'box', size: [1, 1, 1], at: [0, 0.5, 0], color: '#808080' }] };

	it('are checked part by part', () => {
		const none = new Set<string>();
		expect(() => readModelSource({ parts: [] }, none)).toThrow(/parts/);
		expect(() => readModelSource({ parts: [{ ...cube.parts[0], shape: 'teapot' }] }, none)).toThrow(
			/shape/
		);
		expect(() =>
			readModelSource({ parts: [{ shape: 'box', size: [1, 1, 1], at: [0, 0, 0] }] }, none)
		).toThrow(/colour or a material/);
		expect(() =>
			readModelSource({ parts: [{ ...cube.parts[0], material: 'gold' }] }, none)
		).toThrow(/material/);
		expect(() => readModelSource({ parts: [{ ...cube.parts[0], swings: true }] }, none)).toThrow(
			/swing/
		);
	});
});

describe('textures and sounds', () => {
	it('encode PNGs whose size reads back', () => {
		const png = encodePng(4, 2, new Uint8Array(4 * 2 * 4).fill(200));
		expect(pngSize(png)).toEqual({ width: 4, height: 2 });
		expect(pngSize(Buffer.from('GIF89a..........................'))).toBeNull();
	});

	it('render bells as WAV of the bell’s length, and read a sound file’s format and length', () => {
		const wav = encodeWav(renderBell('hand', 8000), 8000);
		expect(audioInfo(wav)).toMatchObject({ format: 'wav' });
		expect(audioInfo(wav)!.duration).toBeCloseTo(2.2, 2);
		expect(audioInfo(Buffer.from('ID3 an mp3 would start like this'))).toBeNull();
	});
});

describe('paint detail (#178)', () => {
	const paint = (output: string) =>
		readTextureSource(
			JSON.parse(readFileSync(path.join('assets', 'textures', `paint-${output}.json`), 'utf8'))
		);

	it('reads a paint recipe without colours, and only with an output', () => {
		expect(paint('normal')).toMatchObject({ recipe: 'paint', output: 'normal', colors: [] });
		expect(() => readTextureSource({ recipe: 'paint', size: 64, seed: 1 })).toThrow(/output/);
		expect(() =>
			readTextureSource({
				recipe: 'paint',
				size: 64,
				seed: 1,
				output: 'normal',
				colors: ['#000000']
			})
		).toThrow(/needs 0 colours/);
	});

	it.each(['normal', 'gloss'])('builds the %s map the same every time, and it tiles', (output) => {
		const source = paint(output);
		const pixels = renderTexture(source);
		expect(encodePng(source.size, source.size, renderTexture(source))).toEqual(
			encodePng(source.size, source.size, pixels)
		);
		// Across the wrap (last row to first, last column to first) the map steps no more than it
		// does anywhere inside: a seam would be the largest step of all.
		const n = source.size;
		const at = (x: number, y: number, c: number) => pixels[(y * n + x) * 4 + c];
		const step = (x0: number, y0: number, x1: number, y1: number) =>
			Math.max(...[0, 1, 2].map((c) => Math.abs(at(x0, y0, c) - at(x1, y1, c))));
		let inside = 0;
		let wrap = 0;
		for (let i = 0; i < n; i++) {
			for (let j = 0; j + 1 < n; j++)
				inside = Math.max(inside, step(j, i, j + 1, i), step(i, j, i, j + 1));
			wrap = Math.max(wrap, step(n - 1, i, 0, i), step(i, n - 1, i, 0));
		}
		expect(inside).toBeGreaterThan(0);
		expect(wrap).toBeLessThanOrEqual(inside);
		if (output === 'normal') {
			// Tangent-space normals: z up, unit length (within 8-bit rounding).
			for (let i = 0; i < n * n; i += 97) {
				const v = [0, 1, 2].map((c) => pixels[i * 4 + c] / 127.5 - 1);
				expect(v[2]).toBeGreaterThan(0.5);
				expect(Math.hypot(...v)).toBeCloseTo(1, 1);
			}
		} else expect(pixels.every((v, i) => i % 4 === 3 || v === pixels[i - (i % 4)])).toBe(true);
	});
});

describe('the pipeline on other sources', () => {
	let dir: string;
	afterEach(() => rmSync(dir, { recursive: true, force: true }));
	/** A copy of the real sources to change. */
	const sources = () => {
		dir = mkdtempSync(path.join(tmpdir(), 'thirdfold-assets-'));
		cpSync('assets', dir, { recursive: true });
		return dir;
	};

	it('names the source that is wrong', async () => {
		const src = sources();
		writeFileSync(path.join(src, 'models', 'prop', 'Bad Name.json'), '{}');
		await expect(buildAssets(src)).rejects.toThrow(
			/Bad Name\.json: file names must be an asset id/
		);
	});

	it('refuses a model made elsewhere that brings extensions', async () => {
		const src = sources();
		const glb = writeGlb(
			bakeModel(
				readModelSource(
					{ parts: [{ shape: 'box', size: [1, 1, 1], at: [0, 0, 0], color: '#ffffff' }] },
					new Set()
				),
				() => '#fff'
			)
		);
		writeFileSync(path.join(src, 'models', 'npc', 'golem.glb'), glb);
		writeFileSync(
			path.join(src, 'models', 'npc', 'golem.meta.json'),
			JSON.stringify({
				provenance: { license: 'LicenseRef-thirdfold-original', author: 'us', modified: false }
			})
		);
		expect((await buildAssets(src)).manifest.models.golem).toMatchObject({
			kind: 'npc',
			triangles: 44 // a chamfered box (#190)
		});
		const length = glb.readUInt32LE(12);
		const text = glb
			.subarray(20, 20 + length)
			.toString('utf8')
			.replace('"asset"', '"extensionsUsed":["X"],"asset"');
		const padded = text + ' '.repeat((4 - (text.length % 4)) % 4);
		const header = Buffer.from(glb.subarray(0, 20));
		header.writeUInt32LE(20 + padded.length + glb.length - 20 - length, 8);
		header.writeUInt32LE(padded.length, 12);
		writeFileSync(
			path.join(src, 'models', 'npc', 'golem.glb'),
			Buffer.concat([header, Buffer.from(padded), glb.subarray(20 + length)])
		);
		await expect(buildAssets(src)).rejects.toThrow(/golem\.glb: extension X is not allowed/);
	});

	it('builds a KTX2 texture checked against its usage', async () => {
		const src = sources();
		cpSync('tests/fixtures/assets/checker.ktx2', path.join(src, 'textures', 'checker.ktx2'));
		const provenance = { license: 'LicenseRef-thirdfold-original', author: 'us', modified: false };
		const meta = (usage: string) => JSON.stringify({ usage, provenance });
		writeFileSync(path.join(src, 'textures', 'checker.meta.json'), meta('albedo'));
		expect((await buildAssets(src)).manifest.textures.checker).toMatchObject({
			format: 'ktx2',
			usage: 'albedo',
			colorSpace: 'srgb',
			width: 8,
			levels: 4,
			layers: 1
		});
		writeFileSync(path.join(src, 'textures', 'checker.meta.json'), meta('normal'));
		await expect(buildAssets(src)).rejects.toThrow(
			/checker\.ktx2: KTX2: declared srgb where linear is needed/
		);
	});

	it('lists a model’s thumbnail (#194), and refuses one with no model, no provenance or too big', async () => {
		const src = sources();
		const thumbs = path.join(src, 'thumbnails');
		const png = encodePng(4, 4, new Uint8Array(64).fill(128));
		writeFileSync(path.join(thumbs, 'well.png'), png);
		cpSync(path.join(thumbs, 'crate.meta.json'), path.join(thumbs, 'well.meta.json'));
		expect((await buildAssets(src)).manifest.models.well.thumbnail).toMatchObject({
			file: expect.stringMatching(/^thumbs\/well\.[0-9a-f]{8}\.png$/),
			bytes: png.length,
			credit: { license: 'LicenseRef-thirdfold-original' }
		});
		rmSync(path.join(thumbs, 'well.meta.json'));
		await expect(buildAssets(src)).rejects.toThrow(/well\.png: no provenance/);
		cpSync(path.join(thumbs, 'crate.meta.json'), path.join(thumbs, 'well.meta.json'));
		writeFileSync(path.join(thumbs, 'well.png'), Buffer.concat([png, Buffer.alloc(64 * 1024)]));
		await expect(buildAssets(src)).rejects.toThrow(/well\.png: \d+ bytes, over 65536/);
		rmSync(path.join(thumbs, 'well.png'));
		cpSync(path.join(thumbs, 'crate.png'), path.join(thumbs, 'moon.png'));
		await expect(buildAssets(src)).rejects.toThrow(/moon\.png: thumbnails are <model id>\.png/);
	});

	it('needs a model for every prop in the catalogue, and known materials and textures', async () => {
		let src = sources();
		rmSync(path.join(src, 'models', 'prop', 'well.json'));
		for (const f of ['well.png', 'well.meta.json']) rmSync(path.join(src, 'thumbnails', f));
		await expect(buildAssets(src)).rejects.toThrow(/no model for the prop "well"/);
		rmSync(dir, { recursive: true, force: true });
		src = sources();
		writeFileSync(
			path.join(src, 'environments', 'moon.json'),
			JSON.stringify({ name: 'Moon', surface: 'cheese', ground: 'oak', walls: 'oak', table: 'oak' })
		);
		await expect(buildAssets(src)).rejects.toThrow(/moon\.json: "surface" must name a material/);
	});

	it('refuses a texture recipe that is not a power of two, and a sound that is not a sound', async () => {
		let src = sources();
		writeFileSync(
			path.join(src, 'textures', 'odd.json'),
			JSON.stringify({ recipe: 'noise', size: 100, colors: ['#000000', '#ffffff'], seed: 1 })
		);
		await expect(buildAssets(src)).rejects.toThrow(/odd\.json: size must be a power of two/);
		rmSync(dir, { recursive: true, force: true });
		src = sources();
		writeFileSync(path.join(src, 'audio', 'noise.ogg'), Buffer.from('<script>alert(1)</script>'));
		await expect(buildAssets(src)).rejects.toThrow(/noise\.ogg: not a WAV or Ogg file/);
	});
});

describe('colour grades', () => {
	it('render a neutral grade as the identity table, black kept black', () => {
		const strip = renderGrade(NEUTRAL);
		expect(stripProblem(strip)).toBeNull();
		// Red across a slice, green down, blue choosing the slice: every texel is its own place.
		for (const [r, g, b] of [
			[0, 0, 0],
			[31, 0, 0],
			[5, 17, 30],
			[31, 31, 31]
		]) {
			const o = (g * 1024 + b * 32 + r) * 4;
			expect([...strip.slice(o, o + 3)]).toEqual([r, g, b].map((v) => Math.round((v * 255) / 31)));
		}
	});

	it('refuse unknown bands, missing bands and values out of range, and a lifted black', () => {
		const day = { saturation: 1.1 };
		expect(() => readGrades({ day, dusk: day, dark: day, noon: day })).toThrow(/unknown band/);
		expect(() => readGrades({ day, dusk: day })).toThrow(/dark: missing/);
		expect(() => readGrades({ day, dusk: day, dark: { gain: [3, 1, 1] } })).toThrow(/gain/);
		const lifted = renderGrade(NEUTRAL);
		lifted[0] = 4;
		expect(stripProblem(lifted)).toMatch(/black/);
	});

	it('give every environment a strip per tone mapper and band, each keeping black', () => {
		const { manifest, files } = built;
		for (const [id, env] of Object.entries(manifest.environments)) {
			expect(env.lut, id).toBeDefined();
			for (const bands of Object.values(env.lut!))
				for (const texture of Object.values(bands)) {
					const t = manifest.textures[texture];
					expect([t.width, t.height]).toEqual([1024, 32]);
					expect(files.has(t.file)).toBe(true);
				}
		}
	});

	it('are refused by the manifest when a strip is unknown or the wrong size', () => {
		const manifest = structuredClone(built.manifest);
		const env = manifest.environments.village;
		env.lut!.agx.dusk = 'nothing';
		expect(parseManifest(manifest)).toMatchObject({ ok: false });
		env.lut!.agx.dusk = Object.keys(manifest.textures).find((t) => !t.startsWith('grade-'))!;
		expect(parseManifest(manifest)).toMatchObject({
			ok: false,
			error: expect.stringMatching(/1024×32/)
		});
	});
});
