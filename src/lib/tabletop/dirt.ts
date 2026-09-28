// Lens dirt (milestone 63, #160, optional): smudges on the lens that only show
// where the bloom lights them, the bloom multiplied by a small in-house texture
// from the asset pipeline (`lens-dirt`, a noise recipe) and added in the output
// stage. Its strength is a uniform, 0 by default, so the look does not change
// until the art review asks for it. The texture loads the first time the
// strength goes above 0; until then, and until it arrives, a 1×1 black stand-in
// is sampled, and swapping it for the real one changes a binding, not a shader.

import * as THREE from 'three/webgpu';
import { texture, uniform } from 'three/tsl';
import { assetUrl, loadManifest } from '../assets/load';

const TEXTURE = 'lens-dirt';

export class LensDirt {
	readonly strength = uniform(0);
	private readonly blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
	/** Sampled across the screen; its value becomes the loaded texture. */
	readonly map = texture(this.blank);
	private loaded: THREE.Texture | null = null;
	private loading = false;
	private disposed = false;

	constructor() {
		// Filtered like the loaded texture, so the sampler's kind never changes.
		this.blank.magFilter = this.blank.minFilter = THREE.LinearFilter;
		this.blank.needsUpdate = true;
	}

	/** How strongly the dirt shows (0 none); above 0 the first time, the texture starts loading. */
	set(strength: number): void {
		this.strength.value = strength;
		if (strength > 0 && !this.loading) {
			this.loading = true;
			void this.load();
		}
	}

	private async load(): Promise<void> {
		const entry = (await loadManifest()).textures[TEXTURE];
		if (!entry) return;
		const map = await new THREE.TextureLoader().loadAsync(assetUrl(entry.file)).catch(() => null);
		if (!map) return console.warn(`[assets] texture "${TEXTURE}" failed to load`);
		if (this.disposed) return map.dispose();
		map.magFilter = map.minFilter = THREE.LinearFilter;
		map.generateMipmaps = false;
		this.loaded = map;
		this.map.value = map;
	}

	dispose(): void {
		this.disposed = true;
		this.blank.dispose();
		this.loaded?.dispose();
	}
}
