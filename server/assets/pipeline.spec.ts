import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { parseManifest } from '../../src/lib/assets/manifest';
import { audioInfo, encodeWav, renderBell } from './audio';
import { checkGlb, writeGlb } from './glb';
import { bakeModel, readModelSource } from './models';
import { buildAssets, staleAssets, type BuiltAssets } from './pipeline';
import { encodePng, pngSize } from './png';
import { checkScenes } from './scenes';

let built: BuiltAssets;
beforeAll(() => {
	built = buildAssets('assets');
});

describe('The adventures’ assets', () => {
	it('are built and committed: static/assets is exactly what assets/ builds', () => {
		// Run `npm run assets` after changing anything in assets/.
		expect(staleAssets(path.join('static', 'assets'), built)).toEqual([]);
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

	it('build the same bytes every time, named by their content', () => {
		const again = buildAssets('assets');
		expect([...again.files.keys()]).toEqual([...built.files.keys()]);
		for (const [file, data] of again.files) expect(data.equals(built.files.get(file)!)).toBe(true);
		for (const file of built.files.keys()) {
			expect(file).toMatch(/^(models|textures|audio)\/[a-z0-9-]+\.[0-9a-f]{8}\.(glb|png|wav)$/);
		}
	});

	it('bake props into one draw per model part group, with the swing and its pivot kept', () => {
		const bell = built.manifest.models['belfry-bell'];
		expect(bell).toMatchObject({ kind: 'prop', swing: { pivot: 2.55, throw: 0.5 } });
		const checked = checkGlb(built.files.get(bell.file)!);
		expect(checked.ok && checked.info.meshes).toEqual(['body', 'swing']);
		const warden = built.manifest.models.warden;
		const figure = checkGlb(built.files.get(warden.file)!);
		expect(figure.ok && figure.info.meshes).toEqual(['body', 'accent']);
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

	it('refuse anything but meshes in a GLB: extensions, links, images, other chunks', () => {
		const glb = writeGlb(bakeModel(readModelSource(cube, new Set()), () => '#ffffff'));
		expect(checkGlb(glb)).toMatchObject({ ok: true, info: { triangles: 12 } });
		const withJson = (edit: (json: Record<string, unknown>) => void) => {
			const length = glb.readUInt32LE(12);
			const json = JSON.parse(glb.subarray(20, 20 + length).toString('utf8'));
			edit(json);
			let text = JSON.stringify(json);
			while (text.length % 4) text += ' ';
			const bin = glb.subarray(20 + length);
			const header = Buffer.alloc(20);
			header.writeUInt32LE(0x46546c67, 0);
			header.writeUInt32LE(2, 4);
			header.writeUInt32LE(20 + text.length + bin.length, 8);
			header.writeUInt32LE(text.length, 12);
			header.writeUInt32LE(0x4e4f534a, 16);
			return Buffer.concat([header, Buffer.from(text), bin]);
		};
		expect(checkGlb(withJson(() => {}))).toMatchObject({ ok: true });
		expect(checkGlb(withJson((j) => (j.extensionsUsed = ['KHR_x'])))).toMatchObject({ ok: false });
		expect(
			checkGlb(withJson((j) => ((j.buffers as { uri?: string }[])[0].uri = 'data:,x')))
		).toMatchObject({ ok: false });
		expect(checkGlb(withJson((j) => (j.images = [{ uri: 'x.png' }])))).toMatchObject({ ok: false });
		expect(checkGlb(withJson((j) => (j.animations = [])))).toMatchObject({ ok: false });
		expect(
			checkGlb(
				withJson(
					(j) => (j.materials = [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }])
				)
			)
		).toMatchObject({ ok: false });
		expect(checkGlb(Buffer.from('not a model at all, just text'))).toMatchObject({ ok: false });
		expect(checkGlb(Buffer.concat([glb, Buffer.alloc(4)]))).toMatchObject({ ok: false });
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

describe('the pipeline on other sources', () => {
	let dir: string;
	afterEach(() => rmSync(dir, { recursive: true, force: true }));
	/** A copy of the real sources to change. */
	const sources = () => {
		dir = mkdtempSync(path.join(tmpdir(), 'thirdfold-assets-'));
		cpSync('assets', dir, { recursive: true });
		return dir;
	};

	it('names the source that is wrong', () => {
		const src = sources();
		writeFileSync(path.join(src, 'models', 'prop', 'Bad Name.json'), '{}');
		expect(() => buildAssets(src)).toThrow(/Bad Name\.json: file names must be an asset id/);
	});

	it('refuses a model made elsewhere that brings extensions', () => {
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
		expect(buildAssets(src).manifest.models.golem).toMatchObject({ kind: 'npc', triangles: 12 });
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
		expect(() => buildAssets(src)).toThrow(/golem\.glb: "extensionsUsed" is not allowed/);
	});

	it('needs a model for every prop in the catalogue, and known materials and textures', () => {
		let src = sources();
		rmSync(path.join(src, 'models', 'prop', 'well.json'));
		expect(() => buildAssets(src)).toThrow(/no model for the prop "well"/);
		rmSync(dir, { recursive: true, force: true });
		src = sources();
		writeFileSync(
			path.join(src, 'environments', 'moon.json'),
			JSON.stringify({ name: 'Moon', surface: 'cheese', ground: 'oak', walls: 'oak', table: 'oak' })
		);
		expect(() => buildAssets(src)).toThrow(/moon\.json: "surface" must name a material/);
	});

	it('refuses a texture recipe that is not a power of two, and a sound that is not a sound', () => {
		let src = sources();
		writeFileSync(
			path.join(src, 'textures', 'odd.json'),
			JSON.stringify({ recipe: 'noise', size: 100, colors: ['#000000', '#ffffff'], seed: 1 })
		);
		expect(() => buildAssets(src)).toThrow(/odd\.json: size must be a power of two/);
		rmSync(dir, { recursive: true, force: true });
		src = sources();
		writeFileSync(path.join(src, 'audio', 'noise.ogg'), Buffer.from('<script>alert(1)</script>'));
		expect(() => buildAssets(src)).toThrow(/noise\.ogg: not a WAV or Ogg file/);
	});
});
