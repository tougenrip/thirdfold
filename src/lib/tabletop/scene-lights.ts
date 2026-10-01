// The scene's base lights (the sky hemisphere and the key light, sun or moon) and fitting them and
// the camera's reach to the table's extents. AtmosphereLayer (atmosphere.ts) aims and colours
// them by the hour; the scene itself, with its fog and environment, is `createScene` there.

import * as THREE from 'three/webgpu';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { SquareGrid } from '$lib/game/grid';
import type { AtmosphereLayer } from './atmosphere';
import { STEP_HEIGHT, WALL_HEIGHT } from './ground';
import { DEFAULT_K } from './lighting';
import { GridLight } from './materials/grid-light-node';
import { SkyHemisphere, SkyLight } from './sky-light';
import { worldExtents, type Extents } from './world-ground';

export { createScene } from './atmosphere';

export interface BaseLights {
	hemisphere: THREE.HemisphereLight;
	sun: THREE.DirectionalLight;
	/** Every point light (#228): `LightingLayer` fills it, and swaps it for a tier's K. */
	grid: GridLight;
}

export function createSceneLights(scene: THREE.Scene): BaseLights {
	// The sky's lights (sky-light.ts): scaled by the sky's reach per cell (#219).
	const hemisphere = new SkyHemisphere(0xfff1dc, 0x1c140e, 0.9);
	scene.add(hemisphere);
	const sun = new SkyLight(0xffe2b8, 1.6);
	sun.castShadow = true;
	sun.shadow.mapSize.set(2048, 2048);
	sun.shadow.bias = -0.0005;
	// Soft PCF: `radius` by tier (quality.ts, `CapabilitiesLayer.set`), read as a uniform.
	sun.shadow.radius = 2;
	// The shadow map is drawn again only when something on the table changed (the renderer's
	// shadowsDirty) or the key light turned (AtmosphereLayer.shadowDue), not when just the camera
	// moves or flames flicker: that pass draws the whole scene a second time.
	sun.shadow.autoUpdate = false;
	scene.add(sun, sun.target);
	// The point lights' one light, here so the lobby's warm-up and the table compile the same.
	const grid = new GridLight(DEFAULT_K);
	scene.add(grid);
	return { hemisphere, sun, grid };
}

/**
 * Fits the key light's shadow box, the fog and the camera's reach to a table's extents
 * (world-ground.ts, returned): the shadow box is the grid up to its top, which the key light fits
 * to its direction each time it draws (`fitShadowFrustum`, #229); the far plane and the haze reach
 * the world's horizon. `fresh`: a new table, whose hour snaps and whose sky is captured at once.
 */
export function fitToTable(
	{ sun }: BaseLights,
	atmosphere: AtmosphereLayer,
	camera: THREE.PerspectiveCamera,
	controls: OrbitControls,
	grid: SquareGrid,
	levels: Uint8Array | null,
	fresh: boolean
): Extents {
	// The play area's box reaches a wall above its highest floor.
	const high = levels ? levels.reduce((a, b) => Math.max(a, b), 0) : 0;
	const extents = worldExtents(grid, { top: (high * STEP_HEIGHT + WALL_HEIGHT) * grid.cellSize });
	const { play, world } = extents;
	camera.far = world.far;
	camera.updateProjectionMatrix();
	const [hw, hd] = [play.width / 2, play.depth / 2];
	atmosphere.shadowBox = { min: [-hw, 0, -hd], max: [hw, play.center.y * 2, hd] };
	// About a fiftieth of a cell along the normal: no acne, no shadow lifting off thin minis.
	sun.shadow.normalBias = 0.02 * grid.cellSize;
	atmosphere.fit(play.center, play.radius, { x: hw, z: hd }, world, fresh);
	controls.maxDistance = play.maxDistance;
	return extents;
}
