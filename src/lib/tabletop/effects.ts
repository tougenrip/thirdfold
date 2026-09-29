// Cinematic moments in the three.js view, played when a line of narration
// carries a cue (see Cue in $lib/game/chat.ts). The toll: the tower bell
// swings, dust sifts down over the table, the table shakes a little, and a
// huge dark shape passes slowly underneath. Presentation only: driven by the
// wall clock like the dice, and never sent over the network. With reduced
// motion the bell still swings, gently, and nothing else moves. The flash:
// the whole table lights up at once (the renderer hands it to
// `CellMaps.setFlash`, which thins the dark in every material's
// `worldModify`) and fades back into the dark over FLASH_MS, exactly as long
// as the server lights the table for (it plays
// alongside a toll; reduced motion keeps it, as it is the one sign of what
// the server's fog is showing for that moment).

import * as THREE from 'three/webgpu';
import { instancedDynamicBufferAttribute } from 'three/tsl';
import { FLASH_MS, type Cue } from '$lib/game/chat';
import { standIn } from './warmup';

const TOLL_MS = 7000;
const DUST = 420;

export interface EffectFrame {
	/** Still playing: render again. */
	active: boolean;
	/** How far the bell swings now (radians). */
	bellAngle: number;
	/** Camera shake to add this frame. */
	shake: THREE.Vector3;
	/** How bright a flash is now: 0 none, 1 everything lit. */
	flash: number;
}

export class EffectsLayer {
	readonly group = new THREE.Group();
	/** One sprite drawn DUST times (sized points on WebGPU too), placed by `positions`. */
	private dust: THREE.Sprite;
	private positions: THREE.InstancedBufferAttribute;
	private dustStart: Float32Array;
	private shadow: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
	private shadowTexture: THREE.CanvasTexture | null;
	private start = 0;
	private cue: Cue | null = null;
	/** When the last flash began, or null when none is playing. */
	private flashStart: number | null = null;
	private size = { w: 20, d: 20, top: 4 };
	private reduced = false;
	private standIns: THREE.Object3D[] | null = null;

	constructor() {
		this.dustStart = new Float32Array(DUST * 3);
		this.positions = new THREE.InstancedBufferAttribute(new Float32Array(DUST * 3), 3);
		const material = new THREE.PointsNodeMaterial({
			color: 0xd8cbb0,
			size: 0.06,
			transparent: true,
			opacity: 0.8,
			depthWrite: false
		});
		material.positionNode = instancedDynamicBufferAttribute(this.positions);
		this.dust = new THREE.Sprite(material);
		this.dust.count = DUST;
		this.dust.visible = false;
		this.dust.frustumCulled = false;
		this.dust.raycast = () => {};

		this.shadowTexture = shadowTexture();
		this.shadow = new THREE.Mesh(
			new THREE.PlaneGeometry(1, 1),
			new THREE.MeshBasicMaterial({
				color: 0x000000,
				transparent: true,
				opacity: 0,
				depthWrite: false,
				...(this.shadowTexture ? { alphaMap: this.shadowTexture } : {})
			})
		);
		this.shadow.rotation.x = -Math.PI / 2;
		// On the floor. Black over the world, so it adds nothing where the fog and the dark have
		// darkened it already, and the output stage re-masks hidden cells (#173); dust falling
		// over them is masked there too.
		this.shadow.position.y = 0.014;
		this.shadow.renderOrder = 0.85;
		this.shadow.visible = false;
		this.shadow.raycast = () => {};
		this.group.add(this.dust, this.shadow);
	}

	/** The table's size (world units) and how high dust starts falling from. */
	setBounds(width: number, depth: number, top: number): void {
		this.size = { w: width, d: depth, top };
		this.shadow.scale.set(width * 0.5, depth * 0.35, 1);
	}

	play(cue: Cue, now: number, reducedMotion: boolean): void {
		if (cue === 'flash') {
			this.flashStart = now;
			return;
		}
		this.cue = cue;
		this.start = now;
		this.reduced = reducedMotion;
		if (reducedMotion) return;
		const pos = this.positions;
		for (let i = 0; i < DUST; i++) {
			// A fixed scatter per particle (no Math.random), so every run looks alike.
			const u = fract(Math.sin(i * 12.9898) * 43758.5453);
			const v = fract(Math.sin(i * 78.233) * 12345.678);
			const h = fract(Math.sin(i * 39.425) * 9876.543);
			this.dustStart[i * 3] = (u - 0.5) * this.size.w;
			this.dustStart[i * 3 + 1] = this.size.top * (0.6 + 0.8 * h);
			this.dustStart[i * 3 + 2] = (v - 0.5) * this.size.d;
			pos.setXYZ(i, this.dustStart[i * 3], this.dustStart[i * 3 + 1], this.dustStart[i * 3 + 2]);
		}
		pos.needsUpdate = true;
		this.dust.visible = true;
		this.shadow.visible = true;
	}

	/** Advances the effect to wall-clock time `now`. */
	tick(now: number): EffectFrame {
		const frame: EffectFrame = {
			active: false,
			bellAngle: 0,
			shake: new THREE.Vector3(),
			flash: 0
		};
		if (this.flashStart !== null) {
			const f = (now - this.flashStart) / FLASH_MS;
			if (f >= 1) this.flashStart = null;
			else {
				frame.active = true;
				// A near-instant flare, held a moment, then a slow fall back into the dark.
				frame.flash = f < 0.05 ? f / 0.05 : f < 0.3 ? 1 : 1 - (f - 0.3) / 0.7;
			}
		}
		if (!this.cue) return frame;
		const t = (now - this.start) / 1000;
		if (t * 1000 >= TOLL_MS) {
			this.stop();
			return frame;
		}
		frame.active = true;
		// The bell: a decaying swing, gentler with reduced motion.
		const amplitude = this.reduced ? 0.12 : 0.45;
		frame.bellAngle = amplitude * Math.sin((t * Math.PI * 2) / 1.7) * Math.exp(-t / 2.6);
		if (this.reduced) return frame;

		// The structure answers: a short shudder as the note hits.
		const shudder = Math.max(0, 1 - t / 1.4) * 0.05;
		frame.shake.set(
			Math.sin(t * 61) * shudder,
			Math.sin(t * 47) * shudder * 0.5,
			Math.sin(t * 53) * shudder
		);

		// Dust sifts down and drifts, fading out.
		const pos = this.positions;
		for (let i = 0; i < DUST; i++) {
			const x0 = this.dustStart[i * 3];
			const y0 = this.dustStart[i * 3 + 1];
			const z0 = this.dustStart[i * 3 + 2];
			const fall = t * (0.6 + 0.4 * fract(i * 0.618));
			pos.setXYZ(i, x0 + Math.sin(t * 1.3 + i) * 0.15, Math.max(0.02, y0 - fall), z0);
		}
		pos.needsUpdate = true;
		this.dust.material.opacity = 0.8 * Math.max(0, 1 - t / 6.5);

		// Something vast moving far below: a shadow crossing the floor, in and out.
		const k = t / (TOLL_MS / 1000);
		this.shadow.position.x = (k - 0.5) * this.size.w * 1.2;
		this.shadow.position.z = Math.sin(k * Math.PI) * this.size.d * 0.08;
		this.shadow.material.opacity = 0.7 * Math.sin(k * Math.PI);
		return frame;
	}

	/**
	 * Stand-ins for the toll's dust and shadow, which show only while it plays, for the warm-up to
	 * compile (#180). The dust stays a sized-points sprite (#145), not a kind (#169): its position
	 * is its own per-particle buffer, which no kind's graph reads; like the shadow it is black or
	 * re-masked over hidden cells by the output stage (#173).
	 */
	gallery(): THREE.Object3D[] {
		if (!this.standIns) {
			const dust = new THREE.Sprite(this.dust.material);
			dust.count = DUST;
			this.standIns = [dust, new THREE.Mesh(this.shadow.geometry, this.shadow.material)];
			for (const o of this.standIns) standIn(o);
		}
		return this.standIns;
	}

	dispose(): void {
		this.dust.material.dispose();
		this.shadow.geometry.dispose();
		this.shadow.material.dispose();
		this.shadowTexture?.dispose();
	}

	private stop(): void {
		this.cue = null;
		this.dust.visible = false;
		this.shadow.visible = false;
	}
}

function fract(x: number): number {
	return x - Math.floor(x);
}

/** A long soft blot, for the shape under the floor. Null where there is no canvas (tests). */
function shadowTexture(): THREE.CanvasTexture | null {
	if (typeof document === 'undefined') return null;
	const canvas = document.createElement('canvas');
	canvas.width = canvas.height = 128;
	const ctx = canvas.getContext('2d');
	if (!ctx) return null;
	const gradient = ctx.createRadialGradient(64, 64, 6, 64, 64, 64);
	gradient.addColorStop(0, '#fff');
	gradient.addColorStop(0.55, '#888');
	gradient.addColorStop(1, '#000');
	ctx.fillStyle = gradient;
	ctx.fillRect(0, 0, 128, 128);
	return new THREE.CanvasTexture(canvas);
}
