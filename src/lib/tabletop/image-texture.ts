// A PNG's bytes (from fetchAsset, already checked) as a texture: decoded off the main thread by
// createImageBitmap, never through an image element's URL, so what was checked is what is drawn
// (#191). Flipped as it decodes, as TextureLoader's image was by the upload, because an
// ImageBitmap ignores `flipY` on WebGL2; the colours are the file's own, unconverted and
// unpremultiplied, as a data map's must be.

import * as THREE from 'three/webgpu';

export async function imageTexture(bytes: ArrayBuffer): Promise<THREE.Texture> {
	const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }), {
		imageOrientation: 'flipY',
		colorSpaceConversion: 'none',
		premultiplyAlpha: 'none'
	});
	const texture = new THREE.Texture(bitmap);
	texture.flipY = false;
	texture.needsUpdate = true;
	// The bitmap's memory goes with the texture.
	texture.addEventListener('dispose', () => bitmap.close());
	return texture;
}
