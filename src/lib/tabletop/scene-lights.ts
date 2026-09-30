// The scene's base lights (the sky hemisphere and the key light, sun or moon) and fitting them and
// the camera's reach to the size of the table. AtmosphereLayer (atmosphere.ts) aims and colours
// them by the hour; the scene itself, with its fog and environment, is `createScene` there.

import * as THREE from 'three/webgpu';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { SquareGrid } from '$lib/game/grid';
import type { AtmosphereLayer } from './atmosphere';
import { SkyHemisphere, SkyLight } from './sky-light';
import { worldExtents } from './world-ground';

export { createScene } from './atmosphere';

/** The camera's far plane for a table as wide as the Hollow (54 across). */
export const FAR = 200;

export interface BaseLights {
	hemisphere: THREE.HemisphereLight;
	sun: THREE.DirectionalLight;
}

export function createSceneLights(scene: THREE.Scene): BaseLights {
	// The sky's lights (sky-light.ts): scaled by the sky's reach per cell (#219).
	const hemisphere = new SkyHemisphere(0xfff1dc, 0x1c140e, 0.9);
	scene.add(hemisphere);
	const sun = new SkyLight(0xffe2b8, 1.6);
	sun.castShadow = true;
	sun.shadow.mapSize.set(2048, 2048);
	sun.shadow.bias = -0.0005;
	// The shadow map is drawn again only when something on the table changed (the renderer's
	// shadowsDirty) or the key light turned (AtmosphereLayer.shadowDue), not when just the camera
	// moves or flames flicker: that pass draws the whole scene a second time.
	sun.shadow.autoUpdate = false;
	scene.add(sun, sun.target);
	return { hemisphere, sun };
}

/**
 * Fits the key light's shadow box, the fog and the camera's reach to a table `extent` across:
 * the box is round the play area's bounding sphere, so it holds for the light from any direction.
 */
export function fitToTable(
	{ sun }: BaseLights,
	atmosphere: AtmosphereLayer,
	camera: THREE.PerspectiveCamera,
	controls: OrbitControls,
	grid: SquareGrid,
	extent: number
): void {
	// The far plane grows with a table wider than the Hollow, so a long table (a train) is not
	// lost in the haze from where the camera frames it.
	camera.far = FAR * Math.max(1, extent / 54);
	camera.updateProjectionMatrix();
	const { center, radius } = worldExtents(grid).play;
	const r = radius;
	// The light stands two radii out (AtmosphereLayer.fit): the sphere lies between one and three.
	Object.assign(sun.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: r, far: 3 * r });
	sun.shadow.camera.updateProjectionMatrix();
	atmosphere.fit(center, radius, extent);
	controls.maxDistance = extent * 2;
}
