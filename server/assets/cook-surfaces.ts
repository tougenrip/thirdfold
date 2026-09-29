// The cook's surface stage (#187, docs/ART.md section 11): a CC0 source set in
// art/surfaces/<id>/ (fetched by scripts/fetch-surfaces.mjs beside its meta.json), stylised
// (stylise.ts), checked to still tile, and encoded as three KTX2 textures the shader kinds' slots
// take: `surface-<id>-albedo` (height in alpha), `-normal` and `-orm`. The build groups them into
// the manifest's `surfaces` (pipeline-textures.ts `buildSurfaces`).

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { USAGE_SPACE, type TextureUsage } from '../../src/lib/assets/manifest';
import { KTX2_SETTINGS, cookImage, type Image } from './cook-textures';
import { readMeta } from './licence';
import { AssetError, json } from './pipeline-files';
import { decodePng } from './png';
import { seamError, stylise, type StyliseRecipe, type SurfaceSource } from './stylise';

/** The files of a surface's folder that are its source: the rest is fetched, by its hash. */
export const SURFACE_SOURCES = ['meta.json', 'touchup.png'];

const SETTINGS = {
	albedo: KTX2_SETTINGS.srgb,
	normal: KTX2_SETTINGS.surfaceNormal,
	orm: KTX2_SETTINGS.surfaceOrm
};

/** A seam this many times worse than the image's own texture fails the cook. */
export const MAX_SEAM = 3;

/** Each map by the names ambientCG and Poly Haven give it. */
const MAPS: Record<keyof SurfaceSource, RegExp> = {
	color: /_(color|diff)[^/]*\.png$/i,
	height: /_(displacement|disp)[^/]*\.png$/i,
	normal: /_(normalgl|nor_gl)[^/]*\.png$/i,
	roughness: /_(roughness|rough)[^/]*\.png$/i,
	ao: /_(ambientocclusion|ao)[^/]*\.png$/i
};

/** A 2:1 set (planks, bricks) stacked on itself, so its texels stay square in a square texture. */
function square(img: Image): Image {
	if (img.width !== img.height * 2) return img;
	const data = new Uint8Array(img.data.length * 2);
	data.set(img.data);
	data.set(img.data, img.data.length);
	return { width: img.width, height: img.width, data };
}

function recipeOf(raw: Record<string, unknown>, where: string): StyliseRecipe {
	const { ramp, detail = 0.25, normalBoost = 1.5 } = raw;
	const ok =
		Array.isArray(ramp) &&
		typeof detail === 'number' &&
		detail >= 0 &&
		detail <= 1 &&
		typeof normalBoost === 'number' &&
		normalBoost > 0 &&
		normalBoost <= 4;
	if (!ok) throw new AssetError(where, 'needs a "ramp", and "detail" 0-1 and "normalBoost" 0-4');
	return { ramp: ramp as string[], detail, normalBoost };
}

/** Lays a hand-painted touch-up over the albedo by its alpha. */
function touchUp(albedo: Image, touchup: Image): void {
	if (touchup.width !== albedo.width || touchup.height !== albedo.height) {
		throw new Error('touchup.png must be the stylised albedo’s size');
	}
	const [a, t] = [albedo.data, touchup.data];
	for (let i = 0; i < a.length; i += 4) {
		const k = t[i + 3];
		for (let c = 0; c < 3; c++)
			a[i + c] = Math.floor((a[i + c] * (255 - k) + t[i + c] * k + 127) / 255);
	}
}

export async function cookSurface(dir: string, id: string): Promise<Map<string, Uint8Array>> {
	const meta = readMeta(dir);
	const metaFile = path.join(dir, 'meta.json');
	const raw = JSON.parse(readFileSync(metaFile, 'utf8')) as Record<string, unknown>;
	const recipe = recipeOf(raw, metaFile);
	const files = readdirSync(dir);
	const read = (map: keyof SurfaceSource): Image | undefined => {
		const file = files.find((f) => MAPS[map].test(f));
		return file ? square(decodePng(readFileSync(path.join(dir, file)))) : undefined;
	};
	const [color, height] = [read('color'), read('height')];
	if (!color || !height) {
		throw new AssetError(dir, 'needs its colour and height maps: run scripts/fetch-surfaces.mjs');
	}
	let maps;
	try {
		maps = stylise(
			{ color, height, normal: read('normal'), roughness: read('roughness'), ao: read('ao') },
			recipe
		);
		const touchup = path.join(dir, 'touchup.png');
		if (existsSync(touchup)) touchUp(maps.albedo, decodePng(readFileSync(touchup)));
	} catch (err) {
		throw new AssetError(dir, (err as Error).message);
	}
	const seam = seamError(maps.albedo);
	if (seam > MAX_SEAM) {
		throw new AssetError(
			dir,
			`it doesn't tile (seam ${seam.toFixed(1)}× its texture): pick another set`
		);
	}
	const size = meta.textureSize ?? 512;
	const out = new Map<string, Uint8Array>();
	for (const usage of ['albedo', 'normal', 'orm'] as const satisfies TextureUsage[]) {
		const name = `textures/surface-${id}-${usage}`;
		out.set(
			`${name}.ktx2`,
			await cookImage(maps[usage], USAGE_SPACE[usage], size, usage === 'normal', SETTINGS[usage])
		);
		out.set(`${name}.meta.json`, Buffer.from(json({ usage, provenance: meta.provenance })));
	}
	return out;
}
