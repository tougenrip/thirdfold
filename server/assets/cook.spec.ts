import { NodeIO, type Document } from '@gltf-transform/core';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { COOK_SETTINGS, LOCK_FILE, checkCook, cook } from './cook';
import { checkGlb } from './glb';
import { buildAssets } from './pipeline';
import { decodePng, encodePng } from './png';

// Two of these build every asset, a few seconds each.
vi.setConfig({ testTimeout: 30_000 });

const ART = path.join('tests', 'fixtures', 'art');
const ORB = 'models/prop/test-orb.glb';
const PROVENANCE = {
	license: 'LicenseRef-thirdfold-original',
	author: 'thirdfold',
	modified: false
};

const temps: string[] = [];
const temp = () => {
	const dir = mkdtempSync(path.join(tmpdir(), 'thirdfold-cook-'));
	temps.push(dir);
	return dir;
};
afterEach(() => {
	for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A copy of the fixture art to change. */
const art = () => {
	const dir = temp();
	cpSync(ART, dir, { recursive: true });
	return dir;
};

/** A GLB's JSON chunk. */
const gltf = (glb: Uint8Array) => {
	const view = Buffer.from(glb);
	return JSON.parse(view.subarray(20, 20 + view.readUInt32LE(12)).toString('utf8'));
};

/** A PNG of any colour type and depth, each row with its own filter (to test the decoder). */
function png(type: number, depth: number, width: number, height: number, samples: number[]) {
	const bpp = ([1, 0, 3, 0, 2, 0, 4][type] * depth) / 8;
	const stride = width * bpp;
	const bytes = Buffer.alloc(stride * height);
	samples.forEach((s, i) => (depth === 16 ? bytes.writeUInt16BE(s, i * 2) : (bytes[i] = s)));
	const raw = Buffer.alloc((stride + 1) * height);
	for (let y = 0; y < height; y++) {
		const filter = y % 5;
		raw[y * (stride + 1)] = filter;
		for (let i = 0; i < stride; i++) {
			const at = (dx: number, dy: number) =>
				i - dx >= 0 && y - dy >= 0 ? bytes[(y - dy) * stride + i - dx] : 0;
			const [a, b, c] = [at(bpp, 0), at(0, 1), at(bpp, 1)];
			const p = a + b - c;
			const paeth =
				Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c)
					? a
					: Math.abs(p - b) <= Math.abs(p - c)
						? b
						: c;
			const predictor = [0, a, b, (a + b) >> 1, paeth][filter];
			raw[y * (stride + 1) + 1 + i] = (bytes[y * stride + i] - predictor) & 255;
		}
	}
	const chunk = (kind: string, data: Buffer) => {
		const body = Buffer.concat([Buffer.from(kind), data]);
		const out = Buffer.alloc(body.length + 8);
		out.writeUInt32BE(data.length);
		body.copy(out, 4);
		out.writeUInt32BE(crc32(body), body.length + 4);
		return out;
	};
	const header = Buffer.alloc(13);
	header.writeUInt32BE(width);
	header.writeUInt32BE(height, 4);
	header[8] = depth;
	header[9] = type;
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk('IHDR', header),
		chunk('IDAT', deflateSync(raw)),
		chunk('IEND', Buffer.alloc(0))
	]);
}

describe('decodePng', () => {
	it('reads back what encodePng writes, with or without the sub filter', () => {
		const rgba = Uint8Array.from({ length: 5 * 3 * 4 }, (_, i) => (i * 37) & 255);
		for (const filter of ['none', 'sub'] as const) {
			expect(decodePng(encodePng(5, 3, rgba, filter))).toEqual({ width: 5, height: 3, data: rgba });
		}
	});

	it('reads grey, grey and alpha, RGB and 16-bit grey and RGB as RGBA, through every row filter', () => {
		const [w, h] = [3, 6];
		const values = (n: number) => Array.from({ length: n }, (_, i) => (i * 53) % 255);
		const grey = values(w * h);
		expect(decodePng(png(0, 8, w, h, grey)).data).toEqual(
			Uint8Array.from(grey.flatMap((g) => [g, g, g, 255]))
		);
		const ga = values(w * h * 2);
		expect(decodePng(png(4, 8, w, h, ga)).data).toEqual(
			Uint8Array.from(grey.flatMap((_, i) => [ga[i * 2], ga[i * 2], ga[i * 2], ga[i * 2 + 1]]))
		);
		const rgb = values(w * h * 3);
		expect(decodePng(png(2, 8, w, h, rgb)).data).toEqual(
			Uint8Array.from(grey.flatMap((_, i) => [rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2], 255]))
		);
		const deep = grey.map((v) => v * 256 + 13);
		expect(decodePng(png(0, 16, w, h, deep)).data).toEqual(
			Uint8Array.from(deep.flatMap((v) => [v >> 8, v >> 8, v >> 8, 255]))
		);
		// A scan's 16-bit normal map (#187).
		const deepRgb = values(w * h * 3).map((v) => v * 256 + 7);
		expect(decodePng(png(2, 16, w, h, deepRgb)).data).toEqual(
			Uint8Array.from(
				grey.flatMap((_, i) => [0, 1, 2].map((c) => deepRgb[i * 3 + c] >> 8).concat(255))
			)
		);
	});

	it('refuses palettes, other depths and interlacing', () => {
		expect(() => decodePng(png(3, 8, 2, 2, [0, 0, 0, 0]))).toThrow(/export 8- or 16-bit/);
		const shallow = png(0, 8, 2, 2, [0, 0, 0, 0]);
		shallow[24] = 4;
		expect(() => decodePng(shallow)).toThrow(/export 8- or 16-bit/);
		const interlaced = png(0, 8, 2, 2, [0, 0, 0, 0]);
		interlaced[28] = 1;
		expect(() => decodePng(interlaced)).toThrow(/interlaced/);
		expect(() => decodePng(Buffer.from('not a png'))).toThrow(/not a PNG/);
	});
});

// Encoding KTX2 takes about 10 s, so the cook's own tests run by hand and in cook.yml, never in
// npm test (CI checks the lock with `assets:cook -- --check`):
// THIRDFOLD_COOK=1 npx vitest run --project server server/assets/cook.spec.ts
describe.skipIf(!process.env.THIRDFOLD_COOK)('the cook', () => {
	it('gives the same bytes every time, and a model with meshopt, KTX2, tangents and LODs', async () => {
		const [a, b] = [temp(), temp()];
		expect(await cook(ART, a)).toEqual({ cooked: ['prop/test-orb'], skipped: [] });
		await cook(ART, b);
		for (const file of [ORB, 'models/prop/test-orb.meta.json', LOCK_FILE]) {
			expect(readFileSync(path.join(a, file)).equals(readFileSync(path.join(b, file)))).toBe(true);
		}

		const glb = readFileSync(path.join(a, ORB));
		const checked = await checkGlb(glb);
		if (!checked.ok) throw new Error(checked.error);
		const { info } = checked;
		expect(info.cooked).toBe(true);
		expect(info.meshes.sort()).toEqual(['accent', 'body', 'body_lod1', 'body_lod2']);
		// Every level of both 16×16 maps: 16, 8, 4, 2, 1.
		expect(info.textures.map((t) => [t.codec, t.colorSpace, t.levels])).toEqual([
			['etc1s', 'srgb', 5],
			['uastc', 'linear', 5]
		]);
		// The sphere is 960 triangles and the box (no LODs, under the floor) 12.
		expect(info.triangles).toBe(972);
		const [lod1, lod2] = info.lods;
		for (const [triangles, i] of [
			[lod1, 0],
			[lod2, 1]
		]) {
			expect(Math.abs(triangles / 960 / COOK_SETTINGS.lods[i].ratio - 1)).toBeLessThan(0.25);
		}

		const json = gltf(glb);
		expect(json.extensionsRequired.sort()).toEqual([
			'EXT_meshopt_compression',
			'KHR_mesh_quantization',
			'KHR_texture_basisu'
		]);
		const body = json.meshes.find((m: { name: string }) => m.name === 'body');
		expect(Object.keys(body.primitives[0].attributes).sort()).toEqual([
			'NORMAL',
			'POSITION',
			'TANGENT',
			'TEXCOORD_0'
		]);
		expect(
			JSON.parse(readFileSync(path.join(a, 'models/prop/test-orb.meta.json'), 'utf8'))
		).toEqual({ provenance: PROVENANCE, screenSizes: [0.25, 0.1] });
	});

	it('skips what hasn’t changed, and --check finds a changed source or output without cooking', async () => {
		const [src, out] = [art(), temp()];
		await cook(src, out);
		const lock = readFileSync(path.join(out, LOCK_FILE));
		expect(await cook(src, out)).toEqual({ cooked: [], skipped: ['prop/test-orb'] });
		expect(readFileSync(path.join(out, LOCK_FILE)).equals(lock)).toBe(true);
		expect(checkCook(src, out)).toEqual([]);
		// Without the art here (kept elsewhere) only the outputs are compared.
		expect(checkCook(temp(), out)).toEqual([]);
		// Nor with only its meta.json here (a generated source, gitignored), and the cook keeps it.
		const only = art();
		rmSync(path.join(only, 'prop', 'test-orb', 'test-orb.glb'));
		expect(checkCook(only, out)).toEqual([]);
		expect(await cook(only, out)).toEqual({ cooked: [], skipped: [] });
		expect(readFileSync(path.join(out, LOCK_FILE)).equals(lock)).toBe(true);

		const meta = path.join(src, 'prop', 'test-orb', 'meta.json');
		writeFileSync(meta, readFileSync(meta, 'utf8') + ' ');
		expect(checkCook(src, out)).toEqual(['prop/test-orb: not cooked since it changed']);
		writeFileSync(path.join(out, ORB), 'edited by hand');
		expect(checkCook(src, out)).toContain(`prop/test-orb: ${ORB} is not what the cook wrote`);
		expect(await cook(src, out)).toEqual({ cooked: ['prop/test-orb'], skipped: [] });
		expect(checkCook(src, out)).toEqual([]);
		rmSync(path.join(out, LOCK_FILE));
		expect(checkCook(src, out)).toEqual([`${LOCK_FILE} is missing`]);
	});

	it('refuses a source a model may not hold, naming it, and keeps LODs made by hand', async () => {
		const io = new NodeIO();
		/** Cooks the fixture after an edit, as if Blender had exported it so. */
		const broken = async (edit: (doc: Document) => void, out = temp()) => {
			const src = art();
			const file = path.join(src, 'prop', 'test-orb', 'test-orb.glb');
			const doc = await io.read(file);
			edit(doc);
			writeFileSync(file, await io.writeBinary(doc));
			return cook(src, out);
		};
		await expect(broken((doc) => doc.getRoot().listNodes()[0].setName('Cube'))).rejects.toThrow(
			/test-orb\.glb: object "Cube" must be named body, swing, accent or flame/
		);
		await expect(
			broken((doc) => {
				const indices = doc.getRoot().listMeshes()[0].listPrimitives()[0].getIndices()!;
				indices.setArray(indices.getArray()!.map(() => 60000) as Uint16Array);
			})
		).rejects.toThrow(/test-orb\.glb: broken indices/);
		await expect(
			broken((doc) => doc.getRoot().listTextures()[0].setMimeType('image/jpeg'))
		).rejects.toThrow(/must be a PNG/);
		const src = art();
		rmSync(path.join(src, 'prop', 'test-orb', 'meta.json'));
		await expect(cook(src, temp())).rejects.toThrow(/needs a meta\.json with its provenance/);

		// A level made by hand stands, and the cook makes none for that role.
		const out = temp();
		await broken((doc) => doc.getRoot().listNodes()[1].setName('body_lod1'), out);
		const checked = await checkGlb(readFileSync(path.join(out, ORB)));
		expect(checked.ok && checked.info.lods).toEqual([12]);
	});

	it('cooks a texture, and the build takes both and builds the same bytes twice', async () => {
		const src = art();
		const texture = path.join(src, 'texture', 'test-grain');
		mkdirSync(texture, { recursive: true });
		const rgba = Uint8Array.from({ length: 32 * 32 * 4 }, (_, i) => (i % 4 === 3 ? 255 : i & 127));
		writeFileSync(path.join(texture, 'test-grain.png'), encodePng(32, 32, rgba));
		writeFileSync(
			path.join(texture, 'meta.json'),
			JSON.stringify({ provenance: PROVENANCE, usage: 'normal', textureSize: 16 })
		);
		const assets = temp();
		cpSync('assets', assets, { recursive: true });
		await cook(src, assets);

		const once = await buildAssets(assets);
		expect(once.manifest.models['test-orb']).toMatchObject({
			kind: 'prop',
			triangles: 972,
			cooked: true,
			lods: [{ screenSize: 0.25 }, { screenSize: 0.1 }]
		});
		expect(once.manifest.textures['test-grain']).toMatchObject({
			format: 'ktx2',
			usage: 'normal',
			colorSpace: 'linear',
			width: 16,
			levels: 5
		});
		const twice = await buildAssets(assets);
		expect([...twice.files.keys()]).toEqual([...once.files.keys()]);
		for (const [file, data] of twice.files) expect(data.equals(once.files.get(file)!)).toBe(true);
	});
});
