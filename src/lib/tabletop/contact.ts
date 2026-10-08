// Contact shadows (#271): a soft dark halo on the floor under every token's base and every prop
// that stands up, so minis and furniture sit on the ground even under torchlight, which casts no
// shadow (only the hero torches and the sun do). Presentation only, from what the viewer was sent:
// TokenLayer hands in each token's place as it glides (`token`), PropLayer each prop's as it lays
// them out (`setProps`). All of them are one InstancedMesh of flat quads on the decal kind's
// instanced graph (materials/contact.ts), one draw however many there are: black, alpha-blended,
// depth-tested but not written, drawn before the other blended surfaces, casting nothing (the
// cached sun shadow never sees it), ending in `worldModify` like every kind, so on an unexplored
// cell it is black on black. Its strength is a uniform per tier (`contactStrength`), and the
// `contact` layer (`?off=contact`) hides it; neither compiles anything. The pure part
// (`tokenContact`, `propContact`) is server-tested in contact.spec.ts.

import * as THREE from 'three/webgpu';
import { cornerToWorld, type SquareGrid } from '$lib/game/grid';
import { ASSETS, footprintCells, type Prop } from '$lib/game/props';
import type { Ground } from './ground';
import { createMaterial, PIECE_MIN, setParams } from './materials';
import { CONTACT_ATTRIBUTE } from './materials/contact';
import { tagged } from './perf';
import type { Tier } from './quality';

/** One halo: its centre on the floor, its size and turn, how dark and how round. */
export interface Contact {
	x: number;
	y: number;
	z: number;
	/** Width (along x before the turn) and depth, world units. */
	w: number;
	d: number;
	/** About the vertical, radians. */
	turn: number;
	/** 0 to 1, times the tier's strength. */
	strength: number;
	/** How round its corners are: 1 a disc (a base), less a rounded rectangle (a prop). */
	soft: number;
}

/** How far a halo reaches past a base, and past a prop's footprint. */
export const TOKEN_SPREAD = 1.25;
export const PROP_SPREAD = 1.1;
/** A prop gets a halo when its model stands this many cells tall or more: rugs, water, cracks and
 * ashes (0.21) don't. */
export const STANDING = 0.25;
/** A prop's corners: the rounded share of its shorter side. */
export const PROP_SOFT = 0.6;
/** Over the floor, in cells, against z-fighting (with the material's polygon offset). */
export const CONTACT_LIFT = 0.003;

/** The tier's strength: low has no screen-space AO, so its halos ground everything alone. */
export const contactStrength = (tier: Tier): number => (tier === 'low' ? 0.7 : 0.45);

/**
 * A token's halo under its base (`diameter` world units across, its centre `x, z` on the floor at
 * `floorY`), `rise` world units up (a hop, a flier's lift): it shrinks and fades as the mini rises.
 */
export function tokenContact(
	x: number,
	floorY: number,
	z: number,
	diameter: number,
	rise: number,
	cellSize: number
): Contact {
	const up = Math.min(Math.max(rise, 0) / Math.max(diameter, 1e-6), 1);
	const size = diameter * TOKEN_SPREAD * (1 - 0.3 * up);
	const y = floorY + CONTACT_LIFT * cellSize;
	return { x, y, z, w: size, d: size, turn: 0, strength: 1 - 0.7 * up, soft: 1 };
}

/**
 * A prop's halo, or none for a flat one (`height`, its model's in cells, under `STANDING`) or one
 * whose model hasn't arrived (null): its footprint (unturned, turned with it) and a margin on the
 * highest floor under it, as PropLayer stands it. `offset` is a glide's or a shake's, in cells.
 */
export function propContact(
	p: Prop,
	grid: SquareGrid,
	ground: Ground | null,
	height: number | null,
	offset: { dx: number; dz: number; turn: number } | null = null
): Contact | null {
	if (height === null || height < STANDING) return null;
	const def = ASSETS[p.assetId];
	const quarter = p.rotation % 2 === 1;
	const corner = cornerToWorld(grid, p.pos);
	const s = grid.cellSize;
	const [fw, fh] = quarter ? [def.h, def.w] : [def.w, def.h];
	const floor = ground ? Math.max(...footprintCells(p).map((c) => ground.floorY(c))) : 0;
	const spread = PROP_SPREAD * s * p.scale;
	return {
		x: corner.x + (fw * s) / 2 + (offset?.dx ?? 0) * s,
		y: floor + CONTACT_LIFT * s,
		z: corner.z + (fh * s) / 2 + (offset?.dz ?? 0) * s,
		w: def.w * spread,
		d: def.h * spread,
		turn: -p.rotation * (Math.PI / 2) + (offset?.turn ?? 0),
		strength: 1,
		soft: PROP_SOFT
	};
}

/** The halos' quad: a cell-unit square facing up. */
function quad(capacity: number): THREE.BufferGeometry {
	const geometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
	const halos = new Float32Array(capacity * 4);
	geometry.setAttribute(CONTACT_ATTRIBUTE, new THREE.InstancedBufferAttribute(halos, 4));
	return geometry;
}

export class ContactShadowLayer {
	mesh: THREE.InstancedMesh;
	private readonly material = createMaterial('decal', { instanced: true });
	private tokens = new Map<string, Contact>();
	private props: ReadonlyMap<string, Contact> = new Map();
	private on = true;
	private readonly matrix = new THREE.Matrix4();
	private readonly at = new THREE.Vector3();
	private readonly turn = new THREE.Quaternion();
	private readonly size = new THREE.Vector3();
	private readonly up = new THREE.Vector3(0, 1, 0);

	constructor(private readonly group: THREE.Object3D) {
		const m = this.material;
		m.polygonOffset = true; // fixed when made: the same pipeline from the first frame
		m.polygonOffsetFactor = -1;
		m.polygonOffsetUnits = -4;
		this.mesh = this.make(PIECE_MIN);
	}

	/** `id`'s halo, or none. `flush` once a change of places is done. */
	token(id: string, halo: Contact | null): void {
		if (halo) this.tokens.set(id, halo);
		else this.tokens.delete(id);
	}

	/** Every prop's halo, by id. Flushes. */
	setProps(halos: ReadonlyMap<string, Contact>): void {
		this.props = halos;
		this.flush();
	}

	/** The tier's strength, and whether the `contact` layer is on. */
	setTier(tier: Tier, on = true): void {
		this.on = on;
		setParams(this.material, { opacity: contactStrength(tier) });
		this.mesh.visible = on;
	}

	/** Writes every halo: a few hundred at most, so all of them each time. */
	flush(): void {
		const all = [...this.tokens.values(), ...this.props.values()];
		if (all.length > this.mesh.instanceMatrix.count) this.grow(Math.ceil(all.length * 1.5));
		const halos = this.mesh.geometry.getAttribute(CONTACT_ATTRIBUTE) as THREE.BufferAttribute;
		all.forEach((c, i) => {
			this.turn.setFromAxisAngle(this.up, c.turn);
			this.matrix.compose(this.at.set(c.x, c.y, c.z), this.turn, this.size.set(c.w, 1, c.d));
			this.mesh.setMatrixAt(i, this.matrix);
			halos.setXYZW(i, c.strength, c.w, c.d, c.soft);
		});
		this.mesh.count = all.length;
		this.mesh.instanceMatrix.needsUpdate = halos.needsUpdate = true;
	}

	dispose(): void {
		this.mesh.removeFromParent();
		this.mesh.geometry.dispose();
		this.mesh.dispose();
		this.material.dispose();
	}

	private make(capacity: number): THREE.InstancedMesh {
		const mesh = new THREE.InstancedMesh(quad(capacity), this.material, capacity);
		mesh.raycast = () => {}; // never picked
		mesh.frustumCulled = false; // one draw, on the floor wherever the minis are
		mesh.renderOrder = -1; // first among the blended surfaces: on the floor, under water and glass
		mesh.count = 0;
		mesh.visible = this.on;
		this.group.add(tagged(mesh, 'contact'));
		return mesh;
	}

	/** Larger, past `PIECE_MIN` either way: the same program. */
	private grow(capacity: number): void {
		const old = this.mesh;
		this.mesh = this.make(capacity);
		old.removeFromParent();
		old.geometry.dispose();
		old.dispose();
	}
}
