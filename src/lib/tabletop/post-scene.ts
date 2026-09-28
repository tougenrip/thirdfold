// The post-processing specs' shared scene (post, effects and grade specs): a glowing box on a
// floor under a shadow-casting sun, drawn through a Post at a tier.

import * as THREE from 'three/webgpu';
import { createNodeRenderer } from './loop';
import { Post } from './post';
import { STILL } from './focus';
import { settingsFor, type QualitySettings, type Tier } from './quality';
import { BACKEND } from './testing';

export async function postScene() {
	const canvas = document.createElement('canvas');
	canvas.width = 320;
	canvas.height = 200;
	const renderer = await createNodeRenderer(canvas, { pixelRatio: 1, backend: BACKEND });
	renderer.setSize(320, 200, false);
	const scene = new THREE.Scene();
	const camera = new THREE.PerspectiveCamera(50, 1.6, 0.1, 50);
	camera.position.set(2, 2, 3);
	camera.lookAt(0, 0, 0);
	const glow = new THREE.MeshStandardMaterial({ color: 'orange', emissive: 'orange' });
	const box = new THREE.Mesh(new THREE.BoxGeometry(), glow);
	const floor = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), new THREE.MeshStandardMaterial());
	floor.rotation.x = -Math.PI / 2;
	floor.position.y = -0.5;
	box.castShadow = floor.receiveShadow = true;
	// A sun casting shadows, as on the table: shadowed materials are the ones that recompile.
	const sun = new THREE.DirectionalLight('white', 2);
	sun.position.set(2, 4, 1);
	sun.castShadow = true;
	scene.add(box, floor, sun, new THREE.AmbientLight('white', 1));
	/** How the frames are seen: the tests move the view and the shot. */
	const view = { ...STILL, target: new THREE.Vector3() };
	const post = new Post(renderer, scene, camera, new THREE.Scene(), () => view);
	const backend = BACKEND === 'webgpu' ? 'webgpu' : 'webgl2';
	const draw = (tier: Tier, on = true, overrides: Partial<QualitySettings> = {}) => {
		const settings = { ...settingsFor(tier, backend), ...overrides };
		post.set({ ...settings, layers: { ...settings.layers, post: on } });
		renderer.info.reset();
		post.render();
	};
	return { renderer, post, draw, view };
}
