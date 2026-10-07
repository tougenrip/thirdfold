import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { texture } from 'three/tsl';
import { mayFlip, quietTextureReads, stillRead } from './still-textures';

/** A texture node as WebGL2's builder leaves it: an OBJECT update for its flipY uniform. */
function built(value: THREE.Texture) {
	const node = texture(value) as unknown as { updateType: string; _matrixUniform: unknown };
	node.updateType = THREE.NodeUpdateType.OBJECT;
	return node;
}

describe('still texture reads (#264)', () => {
	const data = new THREE.DataTexture(new Uint8Array(4), 1, 1);
	const target = new THREE.RenderTarget(1, 1);

	it('never flip data textures, but may flip render targets, depth and flipped bitmaps', () => {
		expect(mayFlip(data)).toBe(false);
		expect(mayFlip(new THREE.DataArrayTexture(new Uint8Array(4), 1, 1, 1))).toBe(false);
		expect(mayFlip(target.texture)).toBe(true);
		expect(mayFlip(new THREE.DepthTexture(1, 1))).toBe(true);
		expect(mayFlip(null)).toBe(true);
	});

	it('leave the update list only when the update could only ever write false', () => {
		const still = built(data);
		const pass = built(target.texture);
		const matrix = built(data);
		matrix._matrixUniform = {};
		const other = { updateType: THREE.NodeUpdateType.OBJECT };
		expect([still, pass, matrix, other].map((n) => stillRead(n))).toEqual([
			true,
			false,
			false,
			false
		]);

		quietTextureReads();
		quietTextureReads(); // once only
		const builder = Object.assign(Object.create(THREE.NodeBuilder.prototype), {
			nodes: [still, pass, matrix, other],
			sequentialNodes: new Set(),
			updateNodes: [],
			updateBeforeNodes: [],
			updateAfterNodes: []
		});
		builder.buildUpdateNodes();
		expect(builder.updateNodes).toEqual([pass, matrix, other]);
	});
});
