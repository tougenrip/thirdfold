// Painted-miniature detail on props and minis (#178), TaleSpire's creature recipe, which needs
// no uv: a paint-noise normal and gloss, sampled triplanar in object space, so the paint sits
// on the model and never swims as an instance glides or a mini hops (r186 gives instanced
// meshes the instance-transformed position as `positionLocal`; `positionGeometry` and
// `normalGeometry` are the model's own). The two maps are data from the `paint` texture recipe
// (server/assets/textures.ts), loaded the first time a painted graph is built; until they
// arrive their texture nodes hold neutral blanks sampled the same way, so the swap changes a
// binding, not a program. How strongly the paint shows is uniforms, shared by every painted
// material: tuning it (the low tier may set the strength to 0) compiles nothing.

import * as THREE from 'three/webgpu';
import { normalGeometry, positionGeometry, texture, uniform } from 'three/tsl';
import { assetUrl, loadManifest } from '../../assets/load';
import { blankTexture, prepareSlotTexture, SLOTS, type SlotSpec } from './defaults';
import { derivativeFrame } from './mapping';
import type { N } from './tsl';

/** Sampled as the normal slot is: linear data, repeating, trilinear. */
const PAINT_SLOT: SlotSpec = SLOTS.normal;

/** The paint's tuning, one set for every painted material. */
export const paint = {
	/** How far the noise tilts the surface normal (0: unpainted). */
	strength: uniform(0.5),
	/** How far gloss moves roughness: `roughness - (gloss - 0.5) × gloss`, clamped to 0.1-1. */
	gloss: uniform(0.4),
	/** Repeats of the maps per model unit (a cell). */
	scale: uniform(1.5)
};

/** The two maps: neutral blanks (straight up, gloss 0.5) until the real ones load. */
const maps = {
	normal: { id: 'paint-normal', node: texture(blankTexture(PAINT_SLOT)) },
	gloss: {
		id: 'paint-gloss',
		node: texture(blankTexture({ ...PAINT_SLOT, texel: [128, 128, 128, 255] }))
	}
};

let loading: Promise<void> | null = null;

/**
 * Loads the paint maps into their texture nodes, once for the page. Never disposed: every
 * tabletop's painted materials sample them, as they do the slot blanks.
 */
export function loadPaint(): Promise<void> {
	loading ??= loadManifest().then((manifest) =>
		Promise.all(
			Object.values(maps).map(async ({ id, node }) => {
				const entry = manifest.textures[id];
				if (!entry) return;
				const map = await new THREE.TextureLoader()
					.loadAsync(assetUrl(entry.file))
					.catch(() => null);
				if (!map) return console.warn(`[assets] texture "${id}" failed to load`);
				node.value = prepareSlotTexture(map, PAINT_SLOT);
			})
		).then(() => undefined)
	);
	return loading;
}

const n = (node: unknown) => node as N;

/** Triplanar weights from the model's normal: sharp, so each face reads one projection. */
function weights(): N {
	const w = n(normalGeometry).abs().pow(4);
	return w.div(w.x.add(w.y).add(w.z));
}

/** Where each of the three projections samples: across x, y and z of the model. */
function planes(): [N, N, N] {
	const p = n(positionGeometry).mul(paint.scale);
	return [p.zy, p.xz, p.xy];
}

/** The view-space tilt a tangent-space sample gives at `at` (mapping.ts's derivative frame). */
function tilt(sampled: N, at: N, normal: N): N {
	const t = sampled.xy.mul(2).sub(1);
	const { T, B } = derivativeFrame(at, normal);
	return T.mul(t.x).add(B.mul(t.y));
}

/** The view-space normal with the paint's bumps added over it (UDN-style), then renormalized. */
export function paintedNormal(normal: N): N {
	void loadPaint();
	const w = weights();
	const [x, y, z] = planes();
	const at = (uv: N) => n(maps.normal.node).sample(uv).setUpdateMatrix(false);
	const bumps = tilt(at(x), x, normal)
		.mul(w.x)
		.add(tilt(at(y), y, normal).mul(w.y))
		.add(tilt(at(z), z, normal).mul(w.z));
	return normal.add(bumps.mul(paint.strength)).normalize();
}

/** Roughness moved by the paint's gloss, smoothness capped at 0.9. */
export function paintedRoughness(roughness: N): N {
	void loadPaint();
	const w = weights();
	const [x, y, z] = planes();
	const at = (uv: N) => n(maps.gloss.node).sample(uv).setUpdateMatrix(false).x;
	const gloss = at(x).mul(w.x).add(at(y).mul(w.y)).add(at(z).mul(w.z));
	return roughness.sub(gloss.sub(0.5).mul(paint.gloss)).clamp(0.1, 1);
}

/** The maps' texture nodes, for tests. */
export const paintMaps = { normal: maps.normal.node, gloss: maps.gloss.node };
