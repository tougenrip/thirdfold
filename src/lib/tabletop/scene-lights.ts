// The scene's base lights (a sky hemisphere, the sun and a warm lamp off to
// one side) and fitting them, the distance haze and the camera's reach to the
// size of the table. LightingLayer sets their strengths for the time of day.

import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/** The distance haze, as tuned for tables up to `extent` across (the Hollow's). */
export const FOG = { near: 40, far: 90, extent: 54 };
/** The camera's far plane for such a table. */
export const FAR = 200;

export interface BaseLights {
	hemisphere: THREE.HemisphereLight;
	sun: THREE.DirectionalLight;
	lamp: THREE.PointLight;
}

export function createSceneLights(scene: THREE.Scene): BaseLights {
	const hemisphere = new THREE.HemisphereLight(0xfff1dc, 0x1c140e, 0.9);
	scene.add(hemisphere);
	const sun = new THREE.DirectionalLight(0xffe2b8, 1.6);
	sun.castShadow = true;
	sun.shadow.mapSize.set(2048, 2048);
	sun.shadow.bias = -0.0005;
	scene.add(sun, sun.target);
	// A warm low light off to one side so the table reads as lit by a lamp, not a studio.
	const lamp = new THREE.PointLight(0xffa04d, 30, 0, 2);
	scene.add(lamp);
	return { hemisphere, sun, lamp };
}

/** Fits the sun's shadow, the lamp, the haze and the camera's reach to a table `extent` across. */
export function fitToTable(
	{ sun, lamp }: BaseLights,
	fog: THREE.Fog,
	camera: THREE.PerspectiveCamera,
	controls: OrbitControls,
	extent: number
): void {
	// Distance haze and the far plane grow with a table wider than the Hollow, so a long
	// table (a train) is not lost in the haze from where the camera frames it.
	const reach = Math.max(1, extent / FOG.extent);
	fog.near = FOG.near * reach;
	fog.far = FOG.far * reach;
	camera.far = FAR * reach;
	camera.updateProjectionMatrix();
	const half = extent / 2;
	Object.assign(sun.shadow.camera, {
		left: -half,
		right: half,
		top: half,
		bottom: -half,
		far: extent * 3
	});
	sun.shadow.camera.updateProjectionMatrix();
	sun.position.set(extent * 0.4, extent, extent * 0.25);
	lamp.position.set(-half * 0.8, extent * 0.25, -half * 0.5);
	controls.maxDistance = extent * 2;
}
