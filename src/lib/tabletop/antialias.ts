// Antialiasing on the HDR image (milestone 63, #163), before depth of field and
// the output stage: TRAA from the prepass's depth and motion, sharpened (AMD
// RCAS), or SMAA, which wants its input linear, before the sRGB encode (the
// compatibility WebGPU stand-in for MSAA). FXAA wants display colour, so it
// stays in the output stage (post.ts); MSAA is the scene pass's own.

import * as THREE from 'three/webgpu';
import { traa } from 'three/examples/jsm/tsl/display/TRAANode.js';
import { sharpen } from 'three/examples/jsm/tsl/display/SharpenNode.js';
import { smaa } from 'three/examples/jsm/tsl/display/SMAANode.js';

/** RCAS on TRAA's resolve: 0 is the most, 2 none. */
const TRAA_SHARPNESS = 0.3;

/** The antialiased picture the output stage reads, and the nodes to dispose with the pipeline. */
export interface Antialiased {
	resolved: THREE.TextureNode;
	owned: { dispose(): void }[];
}

/** TRAA over the scene pass, from the prepass's depth and velocity, sharpened. */
export function temporal(
	scenePass: THREE.PassNode,
	prepass: THREE.PassNode,
	camera: THREE.Camera
): Antialiased {
	const resolvedNode = traa(
		scenePass.getTextureNode('output'),
		prepass.getTextureNode('depth'),
		prepass.getTextureNode('velocity'),
		camera
	);
	// Its texture, not the node: a node would be drawn again into a target of its own.
	const internals = resolvedNode as unknown as {
		getTextureNode(): THREE.TextureNode;
		_previousDepthNode: THREE.TextureNode;
	};
	const sharpened = sharpen(internals.getTextureNode(), TRAA_SHARPNESS);
	// r186's TRAANode leaves its 1×1 previous-depth texture behind: dispose it too.
	const previousDepth = { dispose: () => internals._previousDepthNode.value.dispose() };
	return { resolved: sharpened.getTextureNode(), owned: [resolvedNode, sharpened, previousDepth] };
}

/** SMAA over the scene pass's linear HDR colour. */
export function morphological(scenePass: THREE.PassNode): Antialiased {
	const node = smaa(scenePass.getTextureNode('output'));
	return { resolved: node.getTextureNode(), owned: [node] };
}
