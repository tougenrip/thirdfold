// Texture reads that never need updating per object (the M70 orbit regression, #264). On WebGL2
// three gives every TextureNode a flipY uniform (GLSLNodeBuilder `isFlipY`), which makes the node
// an OBJECT update: `update()` runs for each node of each object drawn, every pass, every frame.
// A kind's graph reads its data textures in well over a hundred places (the GridLight's lists and
// data, the cell maps, the floors' arrays), so the test world ran some 33,000 texture-node updates
// a frame, half the frame's main-thread time. The uniform is true only for a render target's,
// framebuffer's or depth texture's read, or an ImageBitmap uploaded with `flipY`: never for the
// textures our kinds read (data textures, KTX2, and ImageBitmaps decoded already flipped,
// image-texture.ts), so it keeps its initial `false` without updating. Once a node is built, those
// nodes leave its update list; render-target reads (the passes, shadow maps, the hero atlas, the
// sky's PMREM) and reads through a uv matrix keep theirs. WebGPU never flips: nothing changes there.
// ponytail: decided from each node's texture when built; a read whose texture later becomes a
// render target would keep a stale `false`. None does (slots swap data and image textures only).

import * as THREE from 'three/webgpu';

interface Read {
	isTextureNode?: boolean;
	updateType: string;
	value?: THREE.Texture | null;
	_matrixUniform?: unknown;
}

/** Whether three's WebGL2 flipY uniform could ever be true for a read of `texture`. */
export function mayFlip(texture: THREE.Texture | null | undefined): boolean {
	if (!texture) return true; // unknown: keep updating
	const t = texture as THREE.Texture & {
		isRenderTargetTexture?: boolean;
		isFramebufferTexture?: boolean;
		isDepthTexture?: boolean;
	};
	if (t.isRenderTargetTexture || t.isFramebufferTexture || t.isDepthTexture) return true;
	return typeof ImageBitmap !== 'undefined' && t.image instanceof ImageBitmap && t.flipY;
}

/** A texture node whose per-object update only ever sets its flipY uniform to `false`. */
export function stillRead(node: Read): boolean {
	return (
		node.isTextureNode === true &&
		node.updateType === THREE.NodeUpdateType.OBJECT &&
		(node._matrixUniform ?? null) === null &&
		!mayFlip(node.value)
	);
}

let patched = false;

/** Drops still reads from every node builder's update list from now on: once, before compiles. */
export function quietTextureReads(): void {
	if (patched) return;
	patched = true;
	const proto = THREE.NodeBuilder.prototype as unknown as {
		buildUpdateNodes(): void;
		updateNodes: Read[];
	};
	const build = proto.buildUpdateNodes;
	proto.buildUpdateNodes = function (this: { updateNodes: Read[] }) {
		build.call(this);
		const nodes = this.updateNodes;
		let kept = 0;
		for (const node of nodes) if (!stillRead(node)) nodes[kept++] = node;
		nodes.length = kept;
	};
}
