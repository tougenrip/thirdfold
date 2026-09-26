// Ambient effects for the three.js view: low mist drifting over the table at
// dusk and after dark. Purely cosmetic and local: nothing here is state, and
// it never touches the network. A handful of soft, transparent planes share
// one generated texture; `tick` moves them, and the renderer only keeps a
// slow frame timer running while something is drifting. With reduced motion
// there is no mist at all: it is only ever seen drifting.

import * as THREE from 'three';
import type { SquareGrid } from '$lib/game/grid';
import type { Ambient } from '$lib/game/lights';

const BANKS = 6;
/**
 * Just above the grid lines and under the darkness and fog overlays, so mist
 * only shows where the viewer can see, and dims with the light.
 */
const HEIGHT = 0.012;

export class AmbienceLayer {
	readonly group = new THREE.Group();
	private texture: THREE.CanvasTexture | null = null;
	private material: THREE.MeshBasicMaterial;
	private geometry = new THREE.PlaneGeometry(1, 1);
	private banks: { mesh: THREE.Mesh; speed: number; phase: number }[] = [];
	private size = { w: 0, d: 0 };
	private active = false;
	private reducedMotion = false;

	constructor() {
		this.material = new THREE.MeshBasicMaterial({
			color: 0xb8c2d0,
			transparent: true,
			opacity: 0,
			depthWrite: false,
			toneMapped: false
		});
		this.texture = mistTexture();
		if (this.texture) this.material.map = this.texture;
		for (let i = 0; i < BANKS; i++) {
			const mesh = new THREE.Mesh(this.geometry, this.material);
			mesh.rotation.x = -Math.PI / 2;
			mesh.renderOrder = 0.8;
			mesh.raycast = () => {};
			this.group.add(mesh);
			this.banks.push({ mesh, speed: 0.08 + 0.05 * ((i * 7) % 5), phase: i / BANKS });
		}
		this.group.visible = false;
	}

	/** No mist while motion is reduced; takes effect on the next `update`. */
	setReducedMotion(reduced: boolean): void {
		this.reducedMotion = reduced;
	}

	/** Sets the mist for a table and its ambient light: none by day. */
	update(grid: SquareGrid, ambient: Ambient): void {
		this.active = ambient !== 'day' && this.texture !== null && !this.reducedMotion;
		this.group.visible = this.active;
		this.material.opacity = ambient === 'dark' ? 0.2 : 0.14;
		this.size = { w: grid.width * grid.cellSize, d: grid.height * grid.cellSize };
		// Kept to the table: no mist over the dark around it.
		const [hw, hd] = [this.size.w / 2, this.size.d / 2];
		this.material.clippingPlanes = [
			new THREE.Plane(new THREE.Vector3(1, 0, 0), hw),
			new THREE.Plane(new THREE.Vector3(-1, 0, 0), hw),
			new THREE.Plane(new THREE.Vector3(0, 0, 1), hd),
			new THREE.Plane(new THREE.Vector3(0, 0, -1), hd)
		];
		const scale = Math.max(this.size.w, this.size.d) * 0.45;
		this.banks.forEach((b, i) => {
			b.mesh.scale.set(scale, scale * 0.6, 1);
			b.mesh.position.y = HEIGHT + i * 0.001;
		});
	}

	/** Drifts the mist to where it is at time `now` (ms). Returns whether there is mist. */
	tick(now: number): boolean {
		if (!this.active) return false;
		const { w, d } = this.size;
		const t = now / 1000;
		for (const b of this.banks) {
			// Slowly west to east, wrapping, with a gentle sway north and south.
			const x = (((b.phase + (t * b.speed) / w) % 1) + 1) % 1;
			b.mesh.position.x = (x - 0.5) * w * 1.3;
			b.mesh.position.z = Math.sin(t * 0.07 + b.phase * 6.28) * d * 0.35;
		}
		return true;
	}

	dispose(): void {
		this.texture?.dispose();
		this.material.dispose();
		this.geometry.dispose();
	}
}

/** A soft round puff, transparent at the edges. Null where there is no canvas (tests). */
function mistTexture(): THREE.CanvasTexture | null {
	if (typeof document === 'undefined') return null;
	const canvas = document.createElement('canvas');
	canvas.width = canvas.height = 128;
	const ctx = canvas.getContext('2d');
	if (!ctx) return null;
	const gradient = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
	gradient.addColorStop(0, 'rgba(255,255,255,1)');
	gradient.addColorStop(0.5, 'rgba(255,255,255,0.45)');
	gradient.addColorStop(1, 'rgba(255,255,255,0)');
	ctx.fillStyle = gradient;
	ctx.fillRect(0, 0, 128, 128);
	return new THREE.CanvasTexture(canvas);
}
