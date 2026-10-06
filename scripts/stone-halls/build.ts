// The stone-halls pilot kit's pieces as meshes (#263): each part a chamfered primitive (the part
// lists' shapes, server/assets/models.ts), UV'd onto its trim-sheet region, coloured with the
// sheet's mean colour under it times a baked occlusion (what the walls draw until their material
// samples the sheet), merged into one `body` mesh and checked against its role's envelope.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
	ENVELOPES,
	FLOOR_ENVELOPES,
	envelopeProblem,
	type Envelope
} from '../../src/lib/assets/kit';
import { BAKE, bakeInto, solidOf } from '../../server/assets/bake';
import { placementOf, shapeAt, type Shape } from '../../server/assets/models';
import { INSET, PX_PER_U, REGIONS, SIZE, meanColour, type RegionId } from './trim';

export type V3 = [number, number, number];
export interface Part {
	shape: Shape;
	size: V3;
	at: V3;
	turn?: V3;
	region: RegionId;
	/** Multiplies its vertex colour: a joint's backing reads darker than the face. */
	tone?: number;
	/** Ashlar only: where along the 4 u strip the piece's x = -0.5 falls, in units. */
	u?: number;
	/** Ashlar only: added to y to find its course (2 for a wall below its floor, -2..0). */
	ys?: number;
}

export interface Piece {
	id: string;
	/** A role of kit.ts's ENVELOPES, or `floor.tiles` / `floor.broken`. */
	role: string;
	parts: Part[];
	weight?: number;
}

/** The kit's triangle ceiling at LOD0 (LIMITS.kit). */
const MAX_TRIANGLES = 1_500;

const envelopeOf = (role: string): Envelope =>
	role.startsWith('floor.')
		? FLOOR_ENVELOPES[role.slice(6) as keyof typeof FLOOR_ENVELOPES]
		: ENVELOPES[role as keyof typeof ENVELOPES];

/** A hash of a part's place, 0..1: where along its strip a part's face starts. */
const offsetOf = (p: Part) => (((p.at[0] * 7.3 + p.at[1] * 3.1 + p.at[2] * 5.7) % 1) + 1) % 1;

/**
 * A vertex's UV. Ashlar faces that stand upright map by where they are on the wall (x along the
 * strip from the piece's `u`, y up the courses), so the painted joints fall on the blocks' gaps;
 * everything else maps planar per face in the part's own frame at 512 px per unit, the longer side
 * along the strip, squeezed where a face is larger than its region.
 */
function uvOf(
	p: Part,
	local: THREE.Vector3,
	ln: THREE.Vector3,
	world: THREE.Vector3,
	wn: THREE.Vector3
): [number, number] {
	if (p.region === 'ashlar' && Math.abs(wn.y) < 0.7) {
		const along = Math.abs(wn.z) >= Math.abs(wn.x) ? world.x : world.z;
		const y = Math.min(Math.max(world.y + (p.ys ?? 0), 0.002), 1.998);
		const R = REGIONS.ashlar;
		return [
			((p.u ?? 0) + along + 0.5) / 4,
			(R.y + INSET + ((2 - y) / 2) * (R.h - 2 * INSET)) / SIZE
		];
	}
	const region = REGIONS[p.region === 'ashlar' ? 'dressed' : p.region];
	const n = [ln.x, ln.y, ln.z].map(Math.abs);
	const face = n.indexOf(Math.max(...n));
	const [a, b] = [0, 1, 2].filter((k) => k !== face);
	const [along, across] = p.size[a] >= p.size[b] ? [a, b] : [b, a];
	const c = (k: number) => local.getComponent(k) / p.size[k] + 0.5;
	const spanU = Math.min(1, (p.size[along] * PX_PER_U) / (region.w - 2 * INSET));
	const spanV = Math.min(1, (p.size[across] * PX_PER_U) / (region.h - 2 * INSET));
	const o = offsetOf(p);
	const s = o * (1 - spanU) + c(along) * spanU;
	const t = ((o * 7) % 1) * (1 - spanV) + c(across) * spanV;
	return [
		(region.x + INSET + s * (region.w - 2 * INSET)) / SIZE,
		(region.y + INSET + t * (region.h - 2 * INSET)) / SIZE
	];
}

/** A part as geometry in the piece's frame: positions, normals, UVs and colours. */
function partGeometry(
	p: Part,
	albedo: Uint8Array,
	lift: number,
	solids: ReturnType<typeof solidOf>[]
) {
	const g = shapeAt(p.shape, p.size);
	const place = placementOf(p);
	const turn = new THREE.Matrix3().getNormalMatrix(place);
	const pos = g.getAttribute('position');
	const nrm = g.getAttribute('normal');
	const uv = new Float32Array(pos.count * 2);
	const [local, ln, world, wn] = [0, 0, 0, 0].map(() => new THREE.Vector3());
	for (let i = 0; i < pos.count; i++) {
		local.fromBufferAttribute(pos, i);
		ln.fromBufferAttribute(nrm, i);
		world.copy(local).applyMatrix4(place);
		wn.copy(ln).applyMatrix3(turn).normalize();
		uv.set(uvOf(p, local, ln, world, wn), i * 2);
	}
	g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
	g.applyMatrix4(place);
	// Occlusion by the piece's own parts and the floor it stands on (lifted so a piece below its
	// floor stands on its own bottom), as part lists bake it.
	g.translate(0, lift, 0);
	bakeInto(g, solids);
	g.translate(0, -lift, 0);
	const bake = g.getAttribute(BAKE);
	// Colour per face: the vertices that share a normal span the face's UV rectangle.
	const groups = new Map<string, number[]>();
	const n = g.getAttribute('normal');
	for (let i = 0; i < pos.count; i++) {
		const key = [n.getX(i), n.getY(i), n.getZ(i)].map((v) => v.toFixed(2)).join();
		groups.set(key, [...(groups.get(key) ?? []), i]);
	}
	const colors = new Float32Array(pos.count * 3);
	const tone = p.tone ?? 1;
	const half = 12 / SIZE; // at least 24 px round a lone vertex (a lathe's)
	for (const vs of groups.values()) {
		const us = vs.map((i) => uv[i * 2]);
		const ts = vs.map((i) => uv[i * 2 + 1]);
		const [u0, u1] = [Math.min(...us), Math.max(...us)];
		const [v0, v1] = [Math.min(...ts), Math.max(...ts)];
		const mean = meanColour(
			albedo,
			u1 - u0 < 2 * half ? (u0 + u1) / 2 - half : u0,
			v1 - v0 < 2 * half ? (v0 + v1) / 2 - half : v0,
			u1 - u0 < 2 * half ? (u0 + u1) / 2 + half : u1,
			v1 - v0 < 2 * half ? (v0 + v1) / 2 + half : v1
		);
		for (const i of vs) {
			const occ = bake.getX(i);
			const edge = bake.getY(i) - 0.5;
			const k = tone * (0.62 + 0.38 * occ) * (1 + 0.35 * edge);
			colors.set(
				mean.map((c) => Math.min(1, c * k)),
				i * 3
			);
		}
	}
	g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
	g.deleteAttribute(BAKE);
	return g;
}

/** A piece as one geometry, checked: within its role's envelope and the kit's triangles. */
export function pieceGeometry(piece: Piece, albedo: Uint8Array): THREE.BufferGeometry {
	// The piece's lowest point: what lies below its floor bakes standing on its own bottom.
	const box = new THREE.Box3();
	for (const p of piece.parts) {
		const g = shapeAt(p.shape, p.size).applyMatrix4(placementOf(p));
		g.computeBoundingBox();
		box.union(g.boundingBox!);
	}
	const lift = Math.max(0, -box.min.y);
	const solids = piece.parts.map((p) => solidOf({ ...p, at: [p.at[0], p.at[1] + lift, p.at[2]] }));
	const merged = mergeGeometries(
		piece.parts.map((p) => partGeometry(p, albedo, lift, solids)),
		false
	);
	if (!merged) throw new Error(`${piece.id}: parts with different attributes`);
	merged.computeBoundingBox();
	const { min, max } = merged.boundingBox!;
	const problem = envelopeProblem(
		{ min: [min.x, min.y, min.z], max: [max.x, max.y, max.z] },
		envelopeOf(piece.role)
	);
	if (problem) throw new Error(`${piece.id} (${piece.role}): ${problem}`);
	const triangles = merged.getIndex()!.count / 3;
	if (triangles > MAX_TRIANGLES) throw new Error(`${piece.id}: ${triangles} triangles`);
	return merged;
}
