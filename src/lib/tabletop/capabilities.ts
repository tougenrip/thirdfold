// The browser side of quality tiers (quality.ts, #147): what the device offers
// (`probeCapabilities`), and `QualityControl`, which applies a tier to the
// renderer. It owns the canvas's size: the drawing buffer stays within the
// tier's megapixels on every resize and when the window moves to a screen with
// another pixel ratio. It sets the sun's shadow size, which the node renderer
// takes on its next shadow update without recompiling. After an automatic
// tier is set it can refine it once, from the first active frames.

import * as THREE from 'three/webgpu';
import { Capacitor } from '@capacitor/core';
import type { RenderScheduler } from './scheduler';
import { backendOf, gpuInfo, type PerfRecorder } from './perf';
import {
	frameBudgetMs,
	isSoftware,
	pixelRatioFor,
	REFINE_SAMPLES,
	refineTier,
	settingsFor,
	type Caps,
	type QualitySettings,
	type Shell,
	type Tier
} from './quality';
import type { TabletopOptions } from './types';
import { paint } from './materials/paint';
import { setTextureQuality } from './materials/texture-quality';
import { onTextureSwap, setTextureDetail } from '$lib/assets/detail';

/**
 * The tier's texture filtering (#179), paint strength (#178) and texture detail (textures swap
 * size in their slots): uniforms and texture data, no program.
 */
function applyMaterials(settings: QualitySettings, maxAnisotropy: number): void {
	setTextureQuality(settings, maxAnisotropy);
	paint.strength.value = settings.paint;
	setTextureDetail(settings.textureDetail);
}

function shellOf(): Shell {
	const platform = Capacitor.getPlatform();
	if (platform === 'android') return 'capacitor-android';
	if (platform === 'ios') return 'capacitor-ios';
	if (!('__TAURI_INTERNALS__' in window)) return 'browser';
	const ua = navigator.userAgent;
	return /Windows/.test(ua) ? 'tauri-windows' : /Mac OS/.test(ua) ? 'tauri-macos' : 'tauri-linux';
}

interface NavigatorExtras {
	userAgentData?: { mobile?: boolean };
	deviceMemory?: number;
	cpuPerformance?: number;
}

/** What this device offers, read from the renderer (after `init()`) and the browser. */
export function probeCapabilities(renderer: THREE.WebGPURenderer): Caps {
	const b = backendOf(renderer);
	const { backend, compat, adapter } = gpuInfo(renderer);
	const info = b.device?.adapterInfo;
	const gl = b.gl;
	const nav = navigator as Navigator & NavigatorExtras;
	const dpr = window.devicePixelRatio || 1;
	return {
		backend: backend === 'webgl2' ? 'webgl2' : compat ? 'webgpu-compat' : 'webgpu',
		software: isSoftware(adapter),
		vendor: info?.vendor || adapter,
		architecture: info?.architecture || null,
		maxTextureSize:
			b.device?.limits.maxTextureDimension2D ?? gl?.getParameter(gl.MAX_TEXTURE_SIZE) ?? 0,
		timestampQuery: b.device?.features.has('timestamp-query') ?? b.disjoint != null,
		mobile: nav.userAgentData?.mobile ?? /Mobi|Android|iPhone|iPad/.test(nav.userAgent),
		shell: shellOf(),
		dpr,
		screenPixels: Math.round(screen.width * screen.height * dpr * dpr),
		...(nav.deviceMemory !== undefined && { deviceMemory: nav.deviceMemory }),
		...(nav.cpuPerformance !== undefined && { cpuPerformance: nav.cpuPerformance })
	};
}

export class QualityControl {
	readonly caps: Caps;
	private settings: QualitySettings;
	private refining = false;
	private samples: number[] = [];
	private readonly observer: ResizeObserver;
	private stopResolution = () => {};
	/** A texture swapped to another size (texture detail) is drawn at once. */
	private readonly stopSwaps: () => void;

	/**
	 * Sizes `parts.canvas` for the tier and follows its resizes, drawing again after. A fixed
	 * `options.pixelRatio` (tests) holds whatever the tier. Frames come from `parts.perf`;
	 * refinement reports its tier to `options.onTierRefined`, which applies it with `setQuality`.
	 */
	constructor(
		private readonly parts: {
			renderer: THREE.WebGPURenderer;
			canvas: HTMLCanvasElement;
			camera: THREE.PerspectiveCamera;
			sun: THREE.DirectionalLight;
			perf: PerfRecorder;
			loop: RenderScheduler;
			/** Whether the frame just drawn was at play: frames drawn while models load or a warm-up's
			 * gallery shows don't say what the device can do, so they never refine the tier. */
			steady?: () => boolean;
		},
		private readonly options: Pick<TabletopOptions, 'pixelRatio' | 'onTierRefined'>
	) {
		this.caps = probeCapabilities(parts.renderer);
		this.settings = settingsFor('medium', this.caps.backend);
		applyMaterials(this.settings, parts.renderer.getMaxAnisotropy());
		this.observer = new ResizeObserver(() => this.resize());
		this.observer.observe(parts.canvas);
		parts.perf.onFrame = (ms) => this.frame(ms);
		this.watchResolution();
		this.stopSwaps = onTextureSwap(() => parts.loop.request());
	}

	get tier(): Tier {
		return this.settings.tier;
	}

	/** The tier's settings now in force. */
	get current(): QualitySettings {
		return this.settings;
	}

	/** Applies a tier's settings; with `refine`, the first active frames may step it down once. */
	set(settings: QualitySettings, refine = false): void {
		this.settings = settings;
		this.parts.loop.setPacing(settings);
		applyMaterials(settings, this.parts.renderer.getMaxAnisotropy());
		this.refining = refine;
		this.samples = [];
		const size = settings.sunShadowSize;
		const shadow = this.parts.sun.shadow;
		if (shadow.mapSize.x !== size) shadow.mapSize.set(size, size);
		shadow.radius = settings.sunShadowRadius; // a uniform: nothing compiles
		this.resize();
	}

	/** An active frame's main-thread ms (GPU ms need `?perf`, so they are not used here). */
	private frame(ms: number): void {
		if (!this.refining || this.parts.steady?.() === false) return;
		this.samples.push(ms);
		if (this.samples.length < REFINE_SAMPLES) return;
		this.refining = false;
		const tier = refineTier(this.settings.tier, this.samples, frameBudgetMs(this.settings));
		if (tier !== this.settings.tier) this.options.onTierRefined?.(tier);
	}

	private resize(): void {
		const { renderer, canvas, camera } = this.parts;
		const { clientWidth: w, clientHeight: h } = canvas;
		if (!w || !h) return;
		const dpr = window.devicePixelRatio || 1;
		const cap = pixelRatioFor(w, h, dpr, this.settings.megapixels);
		renderer.setPixelRatio(this.options.pixelRatio ?? cap);
		renderer.setSize(w, h, false);
		camera.aspect = w / h;
		camera.updateProjectionMatrix();
		this.parts.loop.request();
	}

	/** A window dragged to a screen with another pixel ratio sizes the canvas again. */
	private watchResolution(): void {
		const query = matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
		const changed = () => {
			this.resize();
			this.stopResolution();
			this.watchResolution();
		};
		query.addEventListener('change', changed, { once: true });
		this.stopResolution = () => query.removeEventListener('change', changed);
	}

	dispose(): void {
		this.parts.perf.onFrame = null;
		this.observer.disconnect();
		this.stopResolution();
		this.stopSwaps();
	}
}
