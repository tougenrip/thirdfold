// Lighting for the three.js view: the ambient preset, a darkness overlay on
// the floor shaped by light levels, a fixed pool of real point lights for the
// nearest sources (so minis and walls glow), and lantern fixtures. Everything
// is derived from state the client was sent; the server already applied the
// rules about what darkness hides. After dark, flames flicker (`flicker`),
// which is cosmetic and costs no state.

import * as THREE from 'three';
import { gridToWorld, type SquareGrid } from '$lib/game/grid';
import { lightLevels, type Ambient, type Light, type LightSource } from '$lib/game/lights';
import type { Blockers } from '$lib/game/objects';
import type { Ground } from './ground';

/** Real point lights available. Fixed so three.js never recompiles shaders as lights come and go. */
const POOL_SIZE = 8;
const FIXTURE_HEIGHT = 0.9;

interface Preset {
	background: number;
	hemisphere: number;
	sun: number;
	lamp: number;
	/** Darkness overlay opacity on unlit cells. */
	dark: number;
}

const PRESETS: Record<Ambient, Preset> = {
	day: { background: 0x16120f, hemisphere: 0.9, sun: 1.6, lamp: 30, dark: 0 },
	dusk: { background: 0x120e10, hemisphere: 0.45, sun: 0.55, lamp: 18, dark: 0.35 },
	dark: { background: 0x07060a, hemisphere: 0.1, sun: 0, lamp: 0, dark: 0.82 }
};

export interface SceneLights {
	hemisphere: THREE.HemisphereLight;
	sun: THREE.DirectionalLight;
	lamp: THREE.PointLight;
	scene: THREE.Scene;
}

export class LightingLayer {
	readonly group = new THREE.Group();
	private overlay: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
	private texture: THREE.DataTexture | null = null;
	private pool: THREE.PointLight[] = [];
	private fixtures = new Map<string, THREE.Group>();
	private postGeometry = new THREE.CylinderGeometry(0.05, 0.08, FIXTURE_HEIGHT, 8);
	private flameGeometry = new THREE.SphereGeometry(0.13, 16, 12);
	private postMaterial = new THREE.MeshStandardMaterial({ color: 0x2b2420, roughness: 0.8 });
	/** Each pool light's steady intensity, which flicker varies around. */
	private steady: number[] = [];
	private ambient: Ambient = 'day';
	/** Per-cell brightness from the last update (0 dark - 1 lit), or null by day. */
	private brightness: Float32Array | null = null;

	constructor(private readonly base: SceneLights) {
		this.overlay = new THREE.Mesh(
			new THREE.PlaneGeometry(1, 1),
			new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, toneMapped: false })
		);
		this.overlay.rotation.x = -Math.PI / 2;
		// Just below the fog overlay, above the grid lines.
		this.overlay.position.y = 0.025;
		this.overlay.renderOrder = 0.9;
		this.overlay.visible = false;
		this.overlay.raycast = () => {};
		this.group.add(this.overlay);
		for (let i = 0; i < POOL_SIZE; i++) {
			const light = new THREE.PointLight(0xffffff, 0, 1, 2);
			this.pool.push(light);
			this.group.add(light);
		}
	}

	/**
	 * Recomputes lighting. `visible` (players under fog) marks cells the server
	 * says the viewer can see; in the dark those are lit by definition, even if
	 * the light itself is out of the viewer's knowledge.
	 */
	update(
		grid: SquareGrid,
		ambient: Ambient,
		lights: readonly Light[],
		sources: readonly LightSource[],
		blocked: Blockers,
		visible: Uint8Array | null,
		ground: Ground | null = null
	): void {
		const preset = PRESETS[ambient];
		this.ambient = ambient;
		this.base.scene.background = new THREE.Color(preset.background);
		if (this.base.scene.fog instanceof THREE.Fog)
			this.base.scene.fog.color.setHex(preset.background);
		this.base.hemisphere.intensity = preset.hemisphere;
		this.base.sun.intensity = preset.sun;
		this.base.sun.castShadow = preset.sun > 0;
		this.base.lamp.intensity = preset.lamp;

		this.updateOverlay(grid, preset.dark, sources, blocked, visible);
		this.updatePool(grid, sources, ambient, ground);
		this.updateFixtures(grid, lights, ground);
	}

	/** Id of the light fixture under the ray, if any. */
	pick(raycaster: THREE.Raycaster): string | null {
		const hit = raycaster.intersectObjects([...this.fixtures.values()], true)[0];
		for (let o: THREE.Object3D | null = hit?.object ?? null; o; o = o.parent) {
			if (typeof o.userData.lightId === 'string') return o.userData.lightId;
		}
		return null;
	}

	dispose(): void {
		this.texture?.dispose();
		this.overlay.geometry.dispose();
		this.overlay.material.dispose();
		for (const f of this.fixtures.values()) this.disposeFixture(f);
		this.postGeometry.dispose();
		this.flameGeometry.dispose();
		this.postMaterial.dispose();
	}

	private updateOverlay(
		grid: SquareGrid,
		darkness: number,
		sources: readonly LightSource[],
		blocked: Blockers,
		visible: Uint8Array | null
	): void {
		if (darkness === 0) {
			this.overlay.visible = false;
			this.brightness = null;
			return;
		}
		const size = grid.width * grid.height;
		if (
			!this.texture ||
			this.texture.image.width !== grid.width ||
			this.texture.image.height !== grid.height
		) {
			this.texture?.dispose();
			this.texture = new THREE.DataTexture(new Uint8Array(size * 4), grid.width, grid.height);
			// Linear filtering turns per-cell levels into a soft falloff.
			this.texture.magFilter = THREE.LinearFilter;
			this.texture.minFilter = THREE.LinearFilter;
			this.texture.colorSpace = THREE.SRGBColorSpace;
			this.overlay.material.map = this.texture;
			this.overlay.material.needsUpdate = true;
		}
		const levels = lightLevels(grid, blocked, sources);
		const data = this.texture.image.data as Uint8Array;
		this.brightness = new Float32Array(size);
		for (let i = 0; i < size; i++) {
			const x = i % grid.width;
			const y = Math.floor(i / grid.width);
			// Rows flipped: texture row 0 is the plane's +z edge, grid row 0 is at −z.
			const o = ((grid.height - 1 - y) * grid.width + x) * 4;
			const level = Math.max(levels[i], visible?.[i] ? 0.55 : 0);
			data[o] = 4;
			data[o + 1] = 3;
			data[o + 2] = 8;
			data[o + 3] = Math.round(255 * darkness * (1 - level));
			this.brightness[i] = 1 - darkness * (1 - level);
		}
		this.texture.needsUpdate = true;
		this.overlay.scale.set(grid.width * grid.cellSize, grid.height * grid.cellSize, 1);
		this.overlay.visible = true;
	}

	/** Gives the pool's point lights to the strongest sources; the rest stay dark (the overlay still shows them). */
	/** How lit each cell looks after the last update (null: all of it, by day). For raised ground. */
	get cellBrightness(): Float32Array | null {
		return this.brightness;
	}

	private updatePool(
		grid: SquareGrid,
		sources: readonly LightSource[],
		ambient: Ambient,
		ground: Ground | null
	): void {
		const chosen = [...sources].sort((a, b) => b.radius - a.radius).slice(0, POOL_SIZE);
		const strength = ambient === 'day' ? 0.5 : 1;
		this.pool.forEach((light, i) => {
			const s = chosen[i];
			if (!s) {
				light.intensity = this.steady[i] = 0;
				return;
			}
			const w = gridToWorld(grid, s.pos);
			const floor = ground?.floorY(s.pos) ?? 0;
			light.position.set(w.x, floor + FIXTURE_HEIGHT * grid.cellSize + 0.1, w.z);
			light.color.set(s.color);
			light.distance = (s.radius + 1.5) * grid.cellSize;
			light.intensity = strength * (4 + s.radius * 2) * grid.cellSize * grid.cellSize;
			this.steady[i] = light.intensity;
		});
	}

	/** Whether anything flickers: lit flames after dark. */
	get flickers(): boolean {
		return this.ambient !== 'day' && this.steady.some((v) => v > 0);
	}

	/**
	 * Makes flames waver for time `now` (ms): each light on its own slow,
	 * irregular beat. Returns whether there is anything to animate.
	 */
	flicker(now: number): boolean {
		if (!this.flickers) return false;
		const t = now / 1000;
		this.pool.forEach((light, i) => {
			const wave = Math.sin(t * 7.3 + i * 1.7) * 0.5 + Math.sin(t * 13.1 + i * 2.9) * 0.3;
			light.intensity = this.steady[i] * (1 + 0.08 * wave);
		});
		let i = 0;
		for (const fixture of this.fixtures.values()) {
			const flame = fixture.children[1];
			const wave = Math.sin(t * 9.7 + i++ * 2.3);
			flame.scale.set(1 - 0.05 * wave, 1 + 0.1 * wave, 1 - 0.05 * wave);
		}
		return true;
	}

	private updateFixtures(grid: SquareGrid, lights: readonly Light[], ground: Ground | null): void {
		const seen = new Set<string>();
		for (const l of lights) {
			seen.add(l.id);
			let fixture = this.fixtures.get(l.id);
			if (!fixture) {
				fixture = this.createFixture(l.id);
				this.fixtures.set(l.id, fixture);
				this.group.add(fixture);
			}
			const w = gridToWorld(grid, l.pos);
			fixture.position.set(w.x, ground?.floorY(l.pos) ?? 0, w.z);
			fixture.scale.setScalar(grid.cellSize);
			const flame = fixture.children[1] as THREE.Mesh<
				THREE.SphereGeometry,
				THREE.MeshStandardMaterial
			>;
			flame.material.color.set(l.on ? l.color : '#3a3530');
			flame.material.emissive.set(l.on ? l.color : '#000000');
			flame.material.emissiveIntensity = l.on ? 2 : 0;
		}
		for (const [id, fixture] of this.fixtures) {
			if (seen.has(id)) continue;
			this.group.remove(fixture);
			this.disposeFixture(fixture);
			this.fixtures.delete(id);
		}
	}

	private createFixture(lightId: string): THREE.Group {
		const post = new THREE.Mesh(this.postGeometry, this.postMaterial);
		post.position.y = FIXTURE_HEIGHT / 2;
		post.castShadow = true;
		const flame = new THREE.Mesh(
			this.flameGeometry,
			new THREE.MeshStandardMaterial({ roughness: 0.3 })
		);
		flame.position.y = FIXTURE_HEIGHT;
		const fixture = new THREE.Group();
		fixture.add(post, flame);
		fixture.userData.lightId = lightId;
		return fixture;
	}

	private disposeFixture(fixture: THREE.Group): void {
		((fixture.children[1] as THREE.Mesh).material as THREE.Material).dispose();
	}
}
