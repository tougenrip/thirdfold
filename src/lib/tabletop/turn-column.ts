// The turn column (#269): a thin column of light rising from the base of the mini whose turn it
// is, in the overlay pass (never bloomed, graded or blurred; the ring under it blooms in the scene
// pass, base-layer.ts). Amber for a character's turn, red for an enemy's, and an enemy's is banded
// as well, so the turn reads without colour (G6, beside the notched rim). Colour, bands and
// strength are uniforms on one material, so a turn starting, ending or changing side compiles
// nothing. It is static: no flicker, no sweep, nothing for reduced motion or Reduce flashing.
//
// The tutorial beacon (previews.ts) stands in the same geometry, `COLUMN`.

import * as THREE from 'three/webgpu';
import { float, fract, mix, pow, step, uniform, uv, vec4 } from 'three/tsl';

/** The open column both the beacon and the turn column stand in: 1 tall, centred, 0.42 at the foot. */
export const COLUMN = new THREE.CylinderGeometry(0.32, 0.42, 1, 24, 1, true);

/** The column's colours, 0xrrggbb sRGB: a character's turn and an enemy's. */
export const TURN_COLOURS = { ally: 0xe0a458, enemy: 0xe27a6b } as const;
/** How tall the column stands, in base diameters' cells (about 1.6 cells for a 0.86 base). */
export const COLUMN_HEIGHT = 1.6;
/** How wide its foot is: the base's 0.43 radius, over the geometry's 0.42. */
const FOOT = 0.43 / 0.42;
/** Bands up an enemy's column, and how much each dark band takes away. */
export const COLUMN_BANDS = 7;
const BAND_DEPTH = 0.85;
/** Its alpha at the foot (each of the open column's two faces; two make well under 1). */
export const STRENGTH = 0.32;

export class TurnColumn {
	readonly mesh: THREE.Mesh;
	private readonly colour = uniform(new THREE.Color(TURN_COLOURS.ally));
	/** 0 for a character's turn, 1 for an enemy's: the bands. */
	private readonly banded = uniform(0);
	/** The column's alpha at its foot (tunable, e.g. by camera distance, without a new program). */
	readonly strength = uniform(STRENGTH);
	private enemy = false;

	constructor() {
		const material = new THREE.MeshBasicNodeMaterial({
			transparent: true,
			blending: THREE.AdditiveBlending,
			depthWrite: false,
			side: THREE.DoubleSide
		});
		// The cylinder's uv.y runs from 0 at the foot to 1 at the top: it thins out upward.
		const up = uv().y;
		const fade = pow(float(1).sub(up), 1.5);
		const band = mix(float(1), step(0.5, fract(up.mul(COLUMN_BANDS))), this.banded.mul(BAND_DEPTH));
		material.colorNode = vec4(this.colour, fade.mul(band).mul(this.strength));
		this.mesh = new THREE.Mesh(COLUMN, material);
		this.mesh.visible = false;
		this.mesh.raycast = () => {};
		this.mesh.renderOrder = 1;
	}

	/** Whether an enemy's turn shows (banded red). */
	get enemyTurn(): boolean {
		return this.enemy;
	}

	/** Its side: amber or banded red. Returns true if it changed. */
	setEnemy(enemy: boolean): boolean {
		if (this.enemy === enemy) return false;
		this.enemy = enemy;
		this.colour.value.setHex(enemy ? TURN_COLOURS.enemy : TURN_COLOURS.ally);
		this.banded.value = enemy ? 1 : 0;
		return true;
	}

	/**
	 * Stands it on `at` (the mini's foot), `size` world units per base cell, or hides it (null).
	 * Returns true if it showed or hid.
	 */
	place(at: THREE.Vector3 | null, size = 1): boolean {
		const was = this.mesh.visible;
		this.mesh.visible = !!at;
		if (at) {
			const tall = COLUMN_HEIGHT * size;
			this.mesh.position.set(at.x, at.y + tall / 2, at.z);
			this.mesh.scale.set(size * FOOT, tall, size * FOOT);
		}
		return was !== this.mesh.visible;
	}

	dispose(): void {
		this.mesh.removeFromParent();
		(this.mesh.material as THREE.Material).dispose(); // the geometry is shared and kept
	}
}
