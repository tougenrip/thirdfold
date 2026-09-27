// The colour grade drawn (#162): one 32³ lookup table in a 3D texture, its
// bytes blended toward the target grade over GRADE_BLEND_MS whenever the
// environment, band or tone mapper changes. The texture stays the same object,
// so the shader that samples it never changes.

import * as THREE from 'three/webgpu';
import { LUT_SIZE } from './environment';

/** How long a change of grade takes to blend in (ms). */
export const GRADE_BLEND_MS = 1500;

/** The identity lookup table: every colour as it is. */
function identityLut(): Uint8Array {
	const n = LUT_SIZE;
	const out = new Uint8Array(n * n * n * 4);
	for (let b = 0; b < n; b++)
		for (let g = 0; g < n; g++)
			for (let r = 0; r < n; r++) {
				const o = ((b * n + g) * n + r) * 4;
				out.set(
					[r, g, b].map((v) => Math.round((v * 255) / (n - 1))),
					o
				);
				out[o + 3] = 255;
			}
	return out;
}
export const IDENTITY = identityLut();

export class GradeBlend {
	readonly texture = new THREE.Data3DTexture(IDENTITY.slice(), LUT_SIZE, LUT_SIZE, LUT_SIZE);
	private blend: { from: Uint8Array; to: Uint8Array; start: number | null } | null = null;

	constructor() {
		// Sampled between entries; the bytes are display values, used as they are.
		this.texture.magFilter = this.texture.minFilter = THREE.LinearFilter;
		this.texture.wrapS = this.texture.wrapT = this.texture.wrapR = THREE.ClampToEdgeWrapping;
		this.texture.needsUpdate = true;
	}

	/** Whether a grade is still blending in (the tabletop keeps drawing while it is). */
	get blending(): boolean {
		return this.blend !== null;
	}

	/**
	 * Blends toward `to` (null: no grade) from whatever is drawn now, or with `snap` puts it in
	 * place at once (a new table: no fade in from its last one).
	 */
	target(to: Uint8Array | null, snap = false): void {
		const next = to ?? IDENTITY;
		if (this.blend ? this.blend.to === next : this.current === next) return;
		this.current = next;
		const data = this.texture.image.data as Uint8Array;
		if (snap) {
			data.set(next);
			this.texture.needsUpdate = true;
			this.blend = null;
			return;
		}
		this.blend = { from: data.slice(), to: next, start: null };
	}

	/** Moves the bytes toward the target at `now`; the first frame of a blend starts it. */
	step(now: number): void {
		const blend = this.blend;
		if (!blend) return;
		blend.start ??= now;
		const k = Math.min((now - blend.start) / GRADE_BLEND_MS, 1);
		const data = this.texture.image.data as Uint8Array;
		for (let i = 0; i < data.length; i++)
			data[i] = Math.round(blend.from[i] + (blend.to[i] - blend.from[i]) * k);
		this.texture.needsUpdate = true;
		if (k >= 1) this.blend = null;
	}

	dispose(): void {
		this.texture.dispose();
	}

	/** The grade last aimed at. */
	private current: Uint8Array = IDENTITY;
}
