// The character minis' pilot (#276), its paint: every part's charts packed into one atlas, then
// each triangle rasterised into it from the standing sculpt, so what a texel shows comes from the
// surface it covers: the paint its part asks for there (a robe's hem, a shield's rim, a face's
// eyes), a little grain in world space (so it runs on across seams), the occlusion the part-list
// bake works out (bake.ts, by the figure's other parts and the floor) as a cool wash in the
// cavities (in the albedo only: ORM red stays open, so ORM is flat and costs little), and painted edge highlights along every sharp convex edge, rim and
// upward face (docs/ART.md section 7: the engine drybrushes only part lists). ORM's alpha is the
// tint mask: white where the token's colour goes, painted there in light greys whose luminance the
// shader keeps.

import * as THREE from 'three';
import { occlusionAt, type Solid } from '../../server/assets/bake';
import type { Mesh } from './mesh';

export interface PaintDef {
	/** sRGB, as a mini painter mixes it. */
	colour: string;
	rough: number;
	metal?: boolean;
	/** In the tint mask: the token's colour replaces its hue. */
	tint?: boolean;
	/** How much world-space grain varies it (cloth's weave, leather's wear, metal's scratches). */
	grain?: number;
}

/** What a paint function sees: the rest-pose point and normal, and the chart-local UV. */
export interface Sample {
	pos: THREE.Vector3;
	n: THREE.Vector3;
	u: number;
	v: number;
}
export type PaintFn = string | ((s: Sample) => string);

export interface Painted {
	part: Mesh;
	paint: PaintFn;
}

/** Atlas pixels kept round each chart, so mips and filtering don't bleed one into the next. */
const PAD = 4;
/** How far a painted edge highlight reaches in from its edge, in units. */
const EDGE_WIDTH = 0.014;
/** A crease sharper than this between two faces is an edge the brush catches. */
const SHARP = Math.cos((30 * Math.PI) / 180);

// ---------------------------------------------------------------- packing

interface Rect {
	x: number;
	y: number;
	w: number;
	h: number;
}

/** Shelf-packs `sizes` (pixels, padding included) into a square of `size`; null if they don't fit. */
function shelves(sizes: { w: number; h: number }[], size: number): Rect[] | null {
	const order = sizes
		.map((_, i) => i)
		.sort((a, b) => sizes[b].h - sizes[a].h || sizes[b].w - sizes[a].w || a - b);
	const out: Rect[] = new Array(sizes.length);
	let [x, y, row] = [0, 0, 0];
	for (const i of order) {
		const { w, h } = sizes[i];
		if (w > size) return null;
		if (x + w > size) [x, y, row] = [0, y + row, 0];
		if (y + h > size) return null;
		out[i] = { x, y, w, h };
		x += w;
		row = Math.max(row, h);
	}
	return out;
}

/** Every chart's rectangle at the highest texel density that fits, and that density. */
function pack(
	charts: { w: number; h: number }[],
	size: number
): { rects: Rect[]; density: number } {
	const at = (d: number) =>
		charts.map((c) => ({
			w: Math.max(4, Math.ceil(c.w * d)) + 2 * PAD,
			h: Math.max(4, Math.ceil(c.h * d)) + 2 * PAD
		}));
	let [lo, hi] = [8, 4096];
	for (let k = 0; k < 30; k++) {
		const mid = (lo + hi) / 2;
		if (shelves(at(mid), size)) lo = mid;
		else hi = mid;
	}
	return { rects: shelves(at(lo), size)!, density: lo };
}

// ---------------------------------------------------------------- noise

function hash(x: number, y: number, z: number): number {
	let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1442695041);
	h = Math.imul(h ^ (h >>> 13), 1274126177);
	return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/** Value noise in 0..1 at a point, `k` cells a unit. */
export function noise(p: THREE.Vector3, k: number): number {
	const [x, y, z] = [p.x * k, p.y * k, p.z * k];
	const [ix, iy, iz] = [Math.floor(x), Math.floor(y), Math.floor(z)];
	const s = (t: number) => t * t * (3 - 2 * t);
	const [fx, fy, fz] = [s(x - ix), s(y - iy), s(z - iz)];
	const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
	const plane = (dz: number) =>
		lerp(
			lerp(hash(ix, iy, iz + dz), hash(ix + 1, iy, iz + dz), fx),
			lerp(hash(ix, iy + 1, iz + dz), hash(ix + 1, iy + 1, iz + dz), fx),
			fy
		);
	return lerp(plane(0), plane(1), fz);
}

// ---------------------------------------------------------------- edges

/**
 * Per triangle, which of its edges a highlight runs along (bit k: the edge opposite corner k):
 * a mesh's open border (a hem, a hood's rim) or a convex crease (a chamfer, a brim), found across
 * vertices that share a place (UV seams split them). On a `smooth` mesh (a lathe, whose facets
 * are only how round it is) a crease is only where the normals split (a brim, a hem's turn).
 */
function sharpEdges(g: THREE.BufferGeometry, smooth: boolean): Uint8Array {
	const p = g.getAttribute('position');
	const nrm = g.getAttribute('normal');
	const index = g.getIndex()!.array;
	const id = new Map<string, number>();
	const at = (i: number) => {
		const key = [p.getX(i), p.getY(i), p.getZ(i)].map((x) => Math.round(x * 1e4)).join();
		let v = id.get(key);
		if (v === undefined) id.set(key, (v = id.size));
		return v;
	};
	const place = Array.from({ length: p.count }, (_, i) => at(i));
	const welded = Array.from(index, (i) => place[i]);
	const faces = index.length / 3;
	const normal: THREE.Vector3[] = [];
	const [a, b, c] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
	for (let f = 0; f < faces; f++) {
		a.fromBufferAttribute(p, index[f * 3]);
		b.fromBufferAttribute(p, index[f * 3 + 1]);
		c.fromBufferAttribute(p, index[f * 3 + 2]);
		normal.push(b.clone().sub(a).cross(c.clone().sub(a)).normalize());
	}
	const edges = new Map<string, [number, number][]>();
	for (let f = 0; f < faces; f++) {
		for (let k = 0; k < 3; k++) {
			const [u, v] = [welded[f * 3 + ((k + 1) % 3)], welded[f * 3 + ((k + 2) % 3)]];
			const key = u < v ? `${u},${v}` : `${v},${u}`;
			edges.set(key, [...(edges.get(key) ?? []), [f, k]]);
		}
	}
	const out = new Uint8Array(faces);
	for (const users of edges.values()) {
		if (users.length === 1) {
			out[users[0][0]] |= 1 << users[0][1];
			continue;
		}
		const [[f, k], [g2, k2]] = users;
		if (normal[f].dot(normal[g2]) > SHARP) continue;
		if (smooth) {
			// The same place on both faces: split normals there make a crease, shared ones a seam.
			const at = index[f * 3 + ((k + 1) % 3)];
			const twin = [1, 2]
				.map((d) => index[g2 * 3 + ((k2 + d) % 3)])
				.find((i) => place[i] === place[at])!;
			a.fromBufferAttribute(nrm, at);
			if (a.dot(c.fromBufferAttribute(nrm, twin)) > 0.95) continue;
		}
		// Convex: the other face's far corner lies behind this face's plane.
		a.fromBufferAttribute(p, index[f * 3 + ((k + 1) % 3)]);
		b.fromBufferAttribute(p, index[g2 * 3 + k2]);
		if (b.sub(a).dot(normal[f]) > 1e-5) continue;
		out[f] |= 1 << k;
		out[g2] |= 1 << k2;
	}
	return out;
}

// ---------------------------------------------------------------- painting

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (e0: number, e1: number, x: number) => {
	const t = clamp01((x - e0) / (e1 - e0));
	return t * t * (3 - 2 * t);
};

/**
 * Paints `parts` into a `size`² albedo and ORM (RGBA each) and gives every part's geometry its
 * atlas UVs. `solids` are what the occlusion bake sees: the figure's parts, standing.
 */
export function paintAtlas(
	parts: Painted[],
	palette: Record<string, PaintDef>,
	solids: Solid[],
	size: number
): { albedo: Uint8Array; orm: Uint8Array; density: number } {
	const charts = parts.flatMap((p) => p.part.charts);
	const { rects, density } = pack(charts, size);
	const albedo = new Uint8Array(size * size * 4);
	const orm = new Uint8Array(size * size * 4);
	const filled = new Uint8Array(size * size);
	let first = 0;
	for (const { part, paint } of parts) {
		const g = part.geometry;
		const pos = g.getAttribute('position');
		const nrm = g.getAttribute('normal');
		const local = g.getAttribute('uv').clone();
		const count = pos.count;
		// Atlas UVs, and each vertex's place in pixels.
		const atlas = new Float32Array(count * 2);
		for (let i = 0; i < count; i++) {
			const r = rects[first + part.chartOf[i]];
			atlas[i * 2] = (r.x + PAD + local.getX(i) * (r.w - 2 * PAD)) / size;
			atlas[i * 2 + 1] = (r.y + PAD + local.getY(i) * (r.h - 2 * PAD)) / size;
		}
		first += part.charts.length;
		// Occlusion by the other parts (a part's own bounds would shut every vertex in).
		const others = solids.filter((s) => s !== part.solid);
		const ao = new Float32Array(count);
		const [p, n] = [new THREE.Vector3(), new THREE.Vector3()];
		for (let i = 0; i < count; i++) {
			p.fromBufferAttribute(pos, i);
			n.fromBufferAttribute(nrm, i).normalize();
			ao[i] = occlusionAt(p, n, others);
		}
		const edges = sharpEdges(g, part.smooth === true);
		const index = g.getIndex()!.array;
		const tri = [0, 1, 2].map(() => ({ p: new THREE.Vector3(), n: new THREE.Vector3() }));
		const sample: Sample = {
			pos: new THREE.Vector3(),
			n: new THREE.Vector3(),
			u: 0,
			v: 0
		};
		for (let f = 0; f < index.length / 3; f++) {
			const vs = [index[f * 3], index[f * 3 + 1], index[f * 3 + 2]];
			vs.forEach((v, k) => {
				tri[k].p.fromBufferAttribute(pos, v);
				tri[k].n.fromBufferAttribute(nrm, v);
			});
			// Each corner's distance to the edge across from it: λ times that is a point's.
			const height = [0, 1, 2].map((k) => {
				const [a, b] = [tri[(k + 1) % 3].p, tri[(k + 2) % 3].p];
				const ab = b.clone().sub(a);
				return tri[k].p.clone().sub(a).cross(ab).length() / Math.max(ab.length(), 1e-9);
			});
			const px = vs.map((v) => [atlas[v * 2] * size, atlas[v * 2 + 1] * size]);
			const area =
				(px[1][0] - px[0][0]) * (px[2][1] - px[0][1]) -
				(px[2][0] - px[0][0]) * (px[1][1] - px[0][1]);
			if (Math.abs(area) < 1e-9) continue;
			const [x0, x1] = [
				Math.floor(Math.min(...px.map((q) => q[0]))),
				Math.ceil(Math.max(...px.map((q) => q[0])))
			];
			const [y0, y1] = [
				Math.floor(Math.min(...px.map((q) => q[1]))),
				Math.ceil(Math.max(...px.map((q) => q[1])))
			];
			for (let y = Math.max(0, y0); y <= Math.min(size - 1, y1); y++) {
				for (let x = Math.max(0, x0); x <= Math.min(size - 1, x1); x++) {
					const [cx, cy] = [x + 0.5, y + 0.5];
					const l1 = ((px[2][0] - cx) * (px[0][1] - cy) - (px[0][0] - cx) * (px[2][1] - cy)) / area;
					const l2 = ((px[0][0] - cx) * (px[1][1] - cy) - (px[1][0] - cx) * (px[0][1] - cy)) / area;
					const l0 = 1 - l1 - l2;
					if (l0 < -1e-4 || l1 < -1e-4 || l2 < -1e-4) continue;
					const l = [l0, l1, l2];
					sample.pos.set(0, 0, 0);
					sample.n.set(0, 0, 0);
					let occ = 0;
					[sample.u, sample.v] = [0, 0];
					for (let k = 0; k < 3; k++) {
						sample.pos.addScaledVector(tri[k].p, l[k]);
						sample.n.addScaledVector(tri[k].n, l[k]);
						occ += ao[vs[k]] * l[k];
						sample.u += local.getX(vs[k]) * l[k];
						sample.v += local.getY(vs[k]) * l[k];
					}
					sample.n.normalize();
					let edge = 0;
					for (let k = 0; k < 3; k++) {
						if (edges[f] & (1 << k))
							edge = Math.max(edge, 1 - smooth(0, EDGE_WIDTH, l[k] * height[k]));
					}
					const id = typeof paint === 'string' ? paint : paint(sample);
					const def = palette[id];
					if (!def) throw new Error(`no paint "${id}"`);
					const o = (y * size + x) * 4;
					shade(def, sample, occ, edge, albedo, o);
					orm[o] = 255;
					orm[o + 1] = Math.round(255 * def.rough);
					orm[o + 2] = def.metal ? 255 : 0;
					orm[o + 3] = def.tint ? 255 : 0;
					filled[y * size + x] = 1;
				}
			}
		}
		g.setAttribute('uv', new THREE.BufferAttribute(atlas, 2));
	}
	const covered = filled.slice();
	dilate(albedo, filled, size, 8);
	dilate(orm, covered, size, 8);
	return { albedo, orm, density };
}

/** One texel of albedo: the paint, its grain, the cavity's cool wash and the brush's highlight. */
function shade(def: PaintDef, s: Sample, occ: number, edge: number, out: Uint8Array, o: number) {
	let c = rgb(def.colour);
	const grain = (noise(s.pos, 90) - 0.5) * 0.6 + (noise(s.pos, 22) - 0.5) * 0.4;
	c = c.map((x) => x * (1 + grain * (def.grain ?? 0.08)));
	// Hue-shifted darks: the cavities go cooler and darker, never black.
	const cavity = 1 - occ;
	c = c.map((x, i) => x * (1 - 0.45 * cavity) + [0, 0.004, 0.03][i] * cavity);
	// The brush catches every convex edge and, more lightly, every face turned up to the light.
	const up = smooth(0.35, 0.95, s.n.y);
	const lift = clamp01(edge * 0.55 + up * 0.14);
	const warm = [1, 0.95, 0.84];
	c = c.map((x, i) => x + (Math.min(1, x * 1.6 + 0.1) * warm[i] - x) * lift);
	for (let i = 0; i < 3; i++) out[o + i] = Math.round(255 * clamp01(c[i]));
	out[o + 3] = 255;
}

/**
 * Spreads painted texels into the empty ones round them, `passes` texels out, so nothing samples
 * the black between charts. Each pass reads the last, so the order texels are visited in doesn't
 * matter.
 */
function dilate(img: Uint8Array, filled: Uint8Array, size: number, passes: number) {
	for (let pass = 0; pass < passes; pass++) {
		const was = filled.slice();
		const src = img.slice();
		for (let y = 0; y < size; y++) {
			for (let x = 0; x < size; x++) {
				if (was[y * size + x]) continue;
				const sum = [0, 0, 0, 0];
				let n = 0;
				for (let dy = -1; dy <= 1; dy++) {
					for (let dx = -1; dx <= 1; dx++) {
						const [qx, qy] = [x + dx, y + dy];
						if (qx < 0 || qy < 0 || qx >= size || qy >= size || !was[qy * size + qx]) continue;
						for (let c = 0; c < 4; c++) sum[c] += src[(qy * size + qx) * 4 + c];
						n++;
					}
				}
				if (!n) continue;
				for (let c = 0; c < 4; c++) img[(y * size + x) * 4 + c] = Math.round(sum[c] / n);
				filled[y * size + x] = 1;
			}
		}
	}
}
