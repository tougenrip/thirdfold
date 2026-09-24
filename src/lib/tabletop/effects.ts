// Cinematic moments in the three.js view, played when a line of narration
// carries a cue (see Cue in $lib/game/chat.ts). The toll: the tower bell
// swings, dust sifts down over the table, the table shakes a little, and a
// huge dark shape passes slowly underneath. Presentation only: driven by the
// wall clock like the dice, and never sent over the network. With reduced
// motion the bell still swings, gently, and nothing else moves.

import * as THREE from 'three';
import type { Cue } from '$lib/game/chat';

const TOLL_MS = 7000;
const DUST = 420;

export interface EffectFrame {
	/** Still playing: render again. */
	active: boolean;
	/** How far the bell swings now (radians). */
	bellAngle: number;
	/** Camera shake to add this frame. */
	shake: THREE.Vector3;
}

export class EffectsLayer {
	readonly group = new THREE.Group();
	private dust: THREE.Points;
	private dustStart: Float32Array;
	private shadow: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
	private shadowTexture: THREE.CanvasTexture | null;
	private start = 0;
	private cue: Cue | null = null;
	private size = { w: 20, d: 20, top: 4 };
	private reduced = false;

	constructor() {
		const geometry = new THREE.BufferGeometry();
		this.dustStart = new Float32Array(DUST * 3);
		geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(DUST * 3), 3));
		this.dust = new THREE.Points(
			geometry,
			new THREE.PointsMaterial({
				color: 0xd8cbb0,
				size: 0.06,
				transparent: true,
				opacity: 0.8,
				depthWrite: false
			})
		);
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
		// On the floor, under the darkness and fog overlays: seen only where the viewer can see.
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
		this.cue = cue;
		this.start = now;
		this.reduced = reducedMotion;
		if (reducedMotion) return;
		const pos = this.dust.geometry.getAttribute('position') as THREE.BufferAttribute;
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
		const frame: EffectFrame = { active: false, bellAngle: 0, shake: new THREE.Vector3() };
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
		const pos = this.dust.geometry.getAttribute('position') as THREE.BufferAttribute;
		for (let i = 0; i < DUST; i++) {
			const x0 = this.dustStart[i * 3];
			const y0 = this.dustStart[i * 3 + 1];
			const z0 = this.dustStart[i * 3 + 2];
			const fall = t * (0.6 + 0.4 * fract(i * 0.618));
			pos.setXYZ(i, x0 + Math.sin(t * 1.3 + i) * 0.15, Math.max(0.02, y0 - fall), z0);
		}
		pos.needsUpdate = true;
		(this.dust.material as THREE.PointsMaterial).opacity = 0.8 * Math.max(0, 1 - t / 6.5);

		// Something vast moving far below: a shadow crossing the floor, in and out.
		const k = t / (TOLL_MS / 1000);
		this.shadow.position.x = (k - 0.5) * this.size.w * 1.2;
		this.shadow.position.z = Math.sin(k * Math.PI) * this.size.d * 0.08;
		this.shadow.material.opacity = 0.7 * Math.sin(k * Math.PI);
		return frame;
	}

	dispose(): void {
		this.dust.geometry.dispose();
		(this.dust.material as THREE.Material).dispose();
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
