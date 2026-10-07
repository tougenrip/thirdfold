// The character minis' pilot (#276), its shapes and rig: lathes (bodies, robes, heads, hats),
// limbs (capsules from one point to another), chamfered boxes (blades, shields' straps, books),
// each UV'd into charts of its own (a lathe one chart round and along, a box one per face), with a
// solid for the occlusion bake; and a skeleton of a dozen bones whose pose bends the standing
// sculpt into the downed one (linear blend skinning: a robe follows the legs by its height).

import * as THREE from 'three';
import type { Solid } from '../../server/assets/bake';
import { shapeAt, type Shape } from '../../server/assets/models';

export type V3 = [number, number, number];

/** A part's geometry in the figure's rest pose: positions, normals, chart-local UVs, chart ids. */
export interface Mesh {
	geometry: THREE.BufferGeometry;
	/** Each chart's size in units (width along u, height along v). */
	charts: { w: number; h: number }[];
	/** Per vertex, which of `charts` its UV lies in. */
	chartOf: Uint16Array;
	solid: Solid | null;
	/** A lathe: its facets are only how round it is, not edges a brush would catch. */
	smooth?: boolean;
}

const solid = (shape: Shape, m: THREE.Matrix4): Solid => {
	const [p, q, s] = [new THREE.Vector3(), new THREE.Quaternion(), new THREE.Vector3()];
	m.decompose(p, q, s);
	return { shape, inverse: m.clone().invert().elements, centre: p, radius: s.length() / 2 };
};

const placement = (at: V3, turn: V3 = [0, 0, 0]) =>
	new THREE.Matrix4().compose(
		new THREE.Vector3(...at),
		new THREE.Quaternion().setFromEuler(new THREE.Euler(...turn)),
		new THREE.Vector3(1, 1, 1)
	);

/**
 * How round the lathes are, as a share of the segments each asks for: about 1.5k triangles a
 * pose, what the Hollow Bell tables' download budget holds (docs/ASSETS.md, "The character minis'
 * pilot"). Raise it with that budget.
 */
export const DETAIL = 0.65;

/** A profile point, bottom to top: radius and height; `sharp` makes a crease (a brim, a hem). */
export type P = [r: number, y: number, sharp?: 1];

export interface LatheOptions {
	segments?: number;
	/** Radial scale across x and z: a torso is deeper than it is wide. */
	sx?: number;
	sz?: number;
	/** The angles it spans (0..2π, the front +z at π/2): a hood or a cloak open at the front. */
	arc?: [number, number];
	at?: V3;
	turn?: V3;
	/** The occluder the bake sees: a cylinder (default), sphere or cone round its bounds. */
	occluder?: Shape | null;
}

/** A surface of revolution about y, one chart: u round (from the back), v up the profile. */
export function lathe(profile: P[], o: LatheOptions = {}): Mesh {
	const seg = Math.max(4, Math.round((o.segments ?? 12) * DETAIL));
	const [sx, sz] = [o.sx ?? 1, o.sz ?? 1];
	const [a0, a1] = o.arc ?? [-Math.PI / 2, (3 * Math.PI) / 2];
	// A sharp point is two rings: each side's slope its own.
	const rings: { r: number; y: number; dr: number; dy: number }[] = [];
	profile.forEach(([r, y, sharp], j) => {
		const prev = profile[Math.max(0, j - 1)];
		const next = profile[Math.min(profile.length - 1, j + 1)];
		if (sharp) {
			rings.push({ r, y, dr: r - prev[0], dy: y - prev[1] });
			rings.push({ r, y, dr: next[0] - r, dy: next[1] - y });
		} else rings.push({ r, y, dr: next[0] - prev[0], dy: next[1] - prev[1] });
	});
	const arc = [0];
	for (let j = 1; j < rings.length; j++)
		arc.push(arc[j - 1] + Math.hypot(rings[j].r - rings[j - 1].r, rings[j].y - rings[j - 1].y));
	const total = arc.at(-1)!;
	const pos: number[] = [];
	const nrm: number[] = [];
	const uv: number[] = [];
	for (let j = 0; j < rings.length; j++) {
		const { r, y, dr, dy } = rings[j];
		for (let i = 0; i <= seg; i++) {
			const a = a0 + ((a1 - a0) * i) / seg;
			const [c, s] = [Math.cos(a), Math.sin(a)];
			pos.push(sx * r * c, y, sz * r * s);
			const n = new THREE.Vector3(dy * sz * c, -sx * sz * dr, dy * sx * s).normalize();
			nrm.push(n.x, n.y, n.z);
			uv.push(i / seg, arc[j] / total);
		}
	}
	const index: number[] = [];
	const v = (j: number, i: number) => j * (seg + 1) + i;
	const P = (k: number) => new THREE.Vector3(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]);
	for (let j = 0; j < rings.length - 1; j++) {
		for (let i = 0; i < seg; i++) {
			for (const t of [
				[v(j, i), v(j, i + 1), v(j + 1, i + 1)],
				[v(j, i), v(j + 1, i + 1), v(j + 1, i)]
			]) {
				const [a, b, c] = t.map(P);
				const cross = b.sub(a).cross(c.sub(a));
				if (cross.lengthSq() < 1e-14) continue; // at a pole, or between a crease's rings
				const n = new THREE.Vector3(nrm[t[0] * 3], nrm[t[0] * 3 + 1], nrm[t[0] * 3 + 2]);
				index.push(...(cross.dot(n) >= 0 ? t : [t[0], t[2], t[1]]));
			}
		}
	}
	const g = new THREE.BufferGeometry();
	g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
	g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
	g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
	g.setIndex(index);
	const m = placement(o.at ?? [0, 0, 0], o.turn);
	g.applyMatrix4(m);
	const rMax = Math.max(...profile.map((p) => p[0]));
	const [yMin, yMax] = [profile[0][1], profile.at(-1)![1]];
	const mean = profile.reduce((s, p) => s + p[0], 0) / profile.length;
	const span = (a1 - a0) / (2 * Math.PI);
	const occluder = o.occluder === undefined ? 'cylinder' : o.occluder;
	return {
		geometry: g,
		charts: [{ w: Math.max(0.01, (2 * Math.PI * mean * span * (sx + sz)) / 2), h: total }],
		chartOf: new Uint16Array(pos.length / 3),
		smooth: true,
		solid: occluder
			? solid(
					occluder,
					m
						.clone()
						.multiply(placement([0, (yMin + yMax) / 2, 0]))
						.scale(new THREE.Vector3(2 * rMax * sx, yMax - yMin, 2 * rMax * sz))
				)
			: null
	};
}

/** Moves `m` (its geometry and its solid) by `at` and `turn` about its own origin; returns the move. */
export function place(m: Mesh, at: V3, turn: V3 = [0, 0, 0]): THREE.Matrix4 {
	const P = placement(at, turn);
	m.geometry.applyMatrix4(P);
	if (m.solid) {
		const unit = new THREE.Matrix4().fromArray(m.solid.inverse).invert();
		m.solid = solid(m.solid.shape, P.clone().multiply(unit));
	}
	return P;
}

/** The turn that points +y along `dir` (a shield's face, a staff, a blade). */
export function turnTo(dir: V3): V3 {
	const q = new THREE.Quaternion().setFromUnitVectors(
		new THREE.Vector3(0, 1, 0),
		new THREE.Vector3(...dir).normalize()
	);
	const e = new THREE.Euler().setFromQuaternion(q);
	return [e.x, e.y, e.z];
}

/**
 * `m` with an inside: its surface again, `depth` in, facing the other way, in a chart of its own
 * (an open hood or cloak seen from the front shows its lining, not the back of its outside).
 */
export function twoSided(m: Mesh, depth = 0.008): Mesh {
	const g = m.geometry;
	const [p, n, uv] = ['position', 'normal', 'uv'].map((k) => g.getAttribute(k).array);
	const count = p.length / 3;
	const index = Array.from(g.getIndex()!.array);
	const flipped: number[] = [];
	for (let i = 0; i < index.length; i += 3)
		flipped.push(index[i] + count, index[i + 2] + count, index[i + 1] + count);
	const out = new THREE.BufferGeometry();
	out.setAttribute(
		'position',
		new THREE.Float32BufferAttribute([...p, ...Array.from(p, (x, i) => x - n[i] * depth)], 3)
	);
	out.setAttribute(
		'normal',
		new THREE.Float32BufferAttribute([...n, ...Array.from(n, (x) => -x)], 3)
	);
	out.setAttribute('uv', new THREE.Float32BufferAttribute([...uv, ...uv], 2));
	out.setIndex([...index, ...flipped]);
	const charts = m.charts.length;
	return {
		geometry: out,
		charts: [...m.charts, ...m.charts],
		chartOf: Uint16Array.from([...m.chartOf, ...Array.from(m.chartOf, (c) => c + charts)]),
		solid: m.solid,
		smooth: m.smooth
	};
}

/** A rounded limb from `a` to `b`, `r0` thick at `a` and `r1` at `b`. */
export function limb(a: V3, b: V3, r0: number, r1: number, segments = 8): Mesh {
	const from = new THREE.Vector3(...a);
	const dir = new THREE.Vector3(...b).sub(from);
	const L = dir.length();
	const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
	const turn = new THREE.Euler().setFromQuaternion(q);
	const cap = (r: number, y: number, up: number): P[] =>
		[0, 0.75].map((k) => [
			r * Math.sin((k * Math.PI) / 2),
			y + up * r * Math.cos((k * Math.PI) / 2)
		]);
	const profile: P[] = [
		...cap(r0, 0, -0.6),
		[r0, 0],
		[(r0 + r1) / 2, L / 2],
		[r1, L],
		...cap(r1, L, 0.6).reverse()
	];
	return lathe(profile, { segments, at: a, turn: [turn.x, turn.y, turn.z] });
}

/** A chamfered box, one chart per face (its chamfers go with the face they lean to). */
export function box(size: V3, at: V3, turn?: V3): Mesh {
	const src = shapeAt('box', size).toNonIndexed();
	const p = src.getAttribute('position');
	const n = src.getAttribute('normal');
	const pos: number[] = [];
	const nrm: number[] = [];
	const uv: number[] = [];
	const chartOf: number[] = [];
	const index: number[] = [];
	const seen = new Map<string, number>();
	const [e1, e2, face] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
	for (let t = 0; t < p.count; t += 3) {
		e1.fromBufferAttribute(p, t + 1).sub(new THREE.Vector3().fromBufferAttribute(p, t));
		e2.fromBufferAttribute(p, t + 2).sub(new THREE.Vector3().fromBufferAttribute(p, t));
		face.crossVectors(e1, e2);
		const abs = [Math.abs(face.x), Math.abs(face.y), Math.abs(face.z)].map((x) => +x.toFixed(6));
		const axis = abs.indexOf(Math.max(...abs));
		const chart = axis * 2 + (face.getComponent(axis) > 0 ? 1 : 0);
		const [ua, va] = [0, 1, 2].filter((k) => k !== axis);
		for (let k = t; k < t + 3; k++) {
			const key = `${p.getX(k)},${p.getY(k)},${p.getZ(k)},${n.getX(k)},${n.getY(k)},${n.getZ(k)},${chart}`;
			let at = seen.get(key);
			if (at === undefined) {
				seen.set(key, (at = pos.length / 3));
				pos.push(p.getX(k), p.getY(k), p.getZ(k));
				nrm.push(n.getX(k), n.getY(k), n.getZ(k));
				uv.push(p.getComponent(k, ua) / size[ua] + 0.5, p.getComponent(k, va) / size[va] + 0.5);
				chartOf.push(chart);
			}
			index.push(at);
		}
	}
	const g = new THREE.BufferGeometry();
	g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
	g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
	g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
	g.setIndex(index);
	const m = placement(at, turn);
	g.applyMatrix4(m);
	const charts = [0, 1, 2].flatMap((axis) => {
		const [ua, va] = [0, 1, 2].filter((k) => k !== axis);
		return [0, 1].map(() => ({ w: size[ua], h: size[va] }));
	});
	return {
		geometry: g,
		charts,
		chartOf: Uint16Array.from(chartOf),
		solid: solid('box', m.clone().scale(new THREE.Vector3(...size)))
	};
}

// ---------------------------------------------------------------- the rig

export const BONES = {
	root: { parent: null, at: [0, 0, 0] },
	hips: { parent: 'root', at: [0, 0.56, 0] },
	spine: { parent: 'hips', at: [0, 0.6, 0] },
	head: { parent: 'spine', at: [0, 0.97, 0] },
	armL: { parent: 'spine', at: [0.16, 0.9, 0] },
	foreL: { parent: 'armL', at: [0.19, 0.68, 0] },
	armR: { parent: 'spine', at: [-0.16, 0.9, 0] },
	foreR: { parent: 'armR', at: [-0.19, 0.68, 0] },
	thighL: { parent: 'hips', at: [0.08, 0.54, 0] },
	shinL: { parent: 'thighL', at: [0.085, 0.29, 0] },
	thighR: { parent: 'hips', at: [-0.08, 0.54, 0] },
	shinR: { parent: 'thighR', at: [-0.085, 0.29, 0] }
} as const satisfies Record<string, { parent: string | null; at: V3 }>;
export type Bone = keyof typeof BONES;
/** Per bone, its turn (Euler XYZ, radians) about its pivot; missing bones stay at rest. */
export type Pose = Partial<Record<Bone, V3>>;

/** Each bone's matrix in `pose`, rest space to posed space. */
export function boneMatrices(pose: Pose): Record<Bone, THREE.Matrix4> {
	const out = {} as Record<Bone, THREE.Matrix4>;
	const of = (b: Bone): THREE.Matrix4 => {
		if (out[b]) return out[b];
		const { parent, at } = BONES[b];
		const pivot = new THREE.Vector3(...(at as V3));
		const local = new THREE.Matrix4()
			.makeTranslation(pivot)
			.multiply(
				new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...(pose[b] ?? [0, 0, 0])))
			)
			.multiply(new THREE.Matrix4().makeTranslation(pivot.clone().negate()));
		return (out[b] = parent
			? of(parent as Bone)
					.clone()
					.multiply(local)
			: local);
	};
	for (const b of Object.keys(BONES) as Bone[]) of(b);
	return out;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** How a vertex follows the bones: one bone, or weights by where it stands at rest. */
export type Binding = Bone | ((x: number, y: number) => [Bone, number][]);

/**
 * Cloth and the body under it, by height: the chest with the spine, the waist with the hips,
 * blending between; below the hips a robe, tabard or cloak follows the legs (left or right by x),
 * the thighs and then the shins.
 */
export const cloth: Binding = (x, y) => {
	const chest = clamp01((y - 0.62) / 0.12);
	const legs = clamp01((0.56 - y) / 0.22);
	const shin = clamp01((0.34 - y) / 0.18);
	const left = clamp01((x + 0.04) / 0.08);
	const hips = (1 - chest) * (1 - legs);
	return [
		['spine', chest],
		['hips', hips],
		['thighL', legs * (1 - shin) * left],
		['shinL', legs * shin * left],
		['thighR', legs * (1 - shin) * (1 - left)],
		['shinR', legs * shin * (1 - left)]
	];
};

/** Moves `g`'s vertices (and normals) by bones: one, or a blend. */
export function skin(
	g: THREE.BufferGeometry,
	bones: Record<Bone, THREE.Matrix4>,
	bone: Binding
): void {
	const p = g.getAttribute('position');
	const n = g.getAttribute('normal');
	const [v, w, m] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Matrix4()];
	const normal = new THREE.Matrix3();
	for (let i = 0; i < p.count; i++) {
		v.fromBufferAttribute(p, i);
		if (typeof bone === 'function') {
			const e = new Array(16).fill(0);
			for (const [b, k] of bone(v.x, v.y)) bones[b].elements.forEach((x, j) => (e[j] += x * k));
			m.fromArray(e);
		} else m.copy(bones[bone]);
		w.fromBufferAttribute(n, i).applyMatrix3(normal.getNormalMatrix(m)).normalize();
		v.applyMatrix4(m);
		p.setXYZ(i, v.x, v.y, v.z);
		n.setXYZ(i, w.x, w.y, w.z);
	}
}
