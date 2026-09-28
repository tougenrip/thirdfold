// Quality tiers (milestone 62, #147): what a device can do (`Caps`) becomes a
// starting tier, and each tier one row of settings every effect reads, so no
// milestone invents its own switch. Pure: no three.js, no DOM (capabilities.ts
// probes the browser). `?tier=` and `?off=` override for A/B tests and
// emergencies and are never saved; the viewer's own choice is kept in
// `thirdfold:graphics`, in this browser only.

import { GRADE_TONE_MAPPER, TONE_MAPPERS, type ToneMapper } from '../assets/manifest';

export const TIERS = ['low', 'medium', 'high', 'ultra'] as const;
export type Tier = (typeof TIERS)[number];

export type Backend = 'webgpu' | 'webgpu-compat' | 'webgl2';
export type Shell =
	| 'browser'
	| 'tauri-windows'
	| 'tauri-macos'
	| 'tauri-linux'
	| 'capacitor-android'
	| 'capacitor-ios';

/** What the device offers, as far as the browser tells. */
export interface Caps {
	backend: Backend;
	/** A software rasteriser (SwiftShader, llvmpipe, lavapipe, softpipe…). */
	software: boolean;
	vendor: string | null;
	architecture: string | null;
	maxTextureSize: number;
	timestampQuery: boolean;
	mobile: boolean;
	shell: Shell;
	dpr: number;
	/** Screen size in device pixels. */
	screenPixels: number;
	/** `navigator.deviceMemory`, GB (capped at 8 by browsers), where given. */
	deviceMemory?: number;
	/** `navigator.cpuPerformance` (Chrome 152+): 1 low to 4 high, where given. */
	cpuPerformance?: number;
}

/** Names a software rasteriser goes by, in a WebGL renderer string or WebGPU adapter info. */
export const isSoftware = (name: string | null) =>
	/swiftshader|llvmpipe|lavapipe|softpipe|software/i.test(name ?? '');

/** The layers later milestones add, each off until it passes its gates; `?off=` turns them off. */
export const LAYERS = [
	'sky',
	'ao',
	'bloom',
	'lens',
	'grade',
	'grass',
	'water',
	'vfx',
	'weather',
	'xray',
	'dof'
] as const;
export type Layer = (typeof LAYERS)[number];

/**
 * Antialiasing (#163): none, FXAA after the tone mapper, SMAA on the HDR image, MSAA 4×, or
 * temporal (TRAA). In order of cost, as the Graphics menu lists them.
 */
export const AA_MODES = ['off', 'fxaa', 'smaa', 'msaa', 'traa'] as const;
export type AaMode = (typeof AA_MODES)[number];

/** TRAA's frames to converge after the last change (under one 32-frame Halton cycle). */
export const TRAA_CONVERGE = 24;

export interface QualitySettings {
	tier: Tier;
	/** Internal resolution cap, in megapixels (the drawing buffer, not CSS pixels). */
	megapixels: number;
	/** Antialiasing; a change of it builds a new renderer. */
	aa: AaMode;
	/** MSAA samples, from `aa`. */
	msaa: 0 | 4;
	ao: boolean;
	/** A glow around flames and what they light hot (#160). */
	bloom: boolean;
	/** The lens (#161): a vignette, chromatic aberration at the edges, film grain. */
	vignette: boolean;
	aberration: boolean;
	grain: boolean;
	/** The environment's colour grade (#162). */
	grade: boolean;
	/**
	 * Depth of field in play, or tilt-shift in the tactical view (#165). Off in every preset:
	 * zooming in on a blurred board gets in the way of play; shots blur whatever this says.
	 */
	miniature: boolean;
	/** Real point lights: a fixed pool, or clustered (ultra, #357). */
	lights: 8 | 16 | 32 | 'clustered';
	/** Torches near the camera that cast shadows (#230). */
	shadowedTorches: 0 | 2 | 4;
	/** The sun's shadow map, per side. */
	sunShadowSize: 1024 | 2048 | 4096;
	/** Particle budget, and vegetation density (0..1). */
	particles: number;
	vegetation: number;
	/** Frames per second while something moves, and for flicker and mist. */
	fpsCap: 30 | 60;
	ambientFps: 20 | 30;
	/**
	 * Anisotropic filtering on every world texture (#179), clamped to what the device offers
	 * (`setTextureQuality`); data textures keep 1.
	 */
	anisotropy: 4 | 8 | 16;
	/**
	 * Two-fetch anti-tiling on walls, raised ground and the table (#181): a variant of their
	 * graphs, so a tier switch that changes it compiles them once.
	 */
	antiTile: boolean;
	/** How strongly props and minis show their paint (#178, `paint.strength`; 0 unpainted). */
	paint: number;
	/** Frames a still picture takes to converge, from `aa` (TRAA's history). */
	convergeFrames: number;
	layers: Record<Layer, boolean>;
	/** The viewer's tone mapper (the Graphics menu, `?tonemap=`); else `GRADE_TONE_MAPPER`. */
	toneMapper?: ToneMapper;
}

const ROWS: Record<Tier, Omit<QualitySettings, 'tier' | 'layers' | 'msaa' | 'convergeFrames'>> = {
	low: {
		megapixels: 1.0,
		aa: 'fxaa',
		ao: false,
		bloom: true,
		vignette: true,
		aberration: true,
		grain: true,
		grade: true,
		miniature: false,
		lights: 8,
		shadowedTorches: 0,
		sunShadowSize: 1024,
		particles: 250,
		vegetation: 0.25,
		fpsCap: 30,
		ambientFps: 20,
		anisotropy: 4,
		antiTile: false,
		paint: 0
	},
	medium: {
		megapixels: 2.1,
		aa: 'msaa',
		ao: true,
		bloom: true,
		vignette: true,
		aberration: true,
		grain: true,
		grade: true,
		miniature: false,
		lights: 16,
		shadowedTorches: 2,
		sunShadowSize: 2048,
		particles: 1000,
		vegetation: 0.5,
		fpsCap: 60,
		ambientFps: 30,
		anisotropy: 8,
		antiTile: true,
		paint: 0.5
	},
	high: {
		megapixels: 3.7,
		aa: 'traa',
		ao: true,
		bloom: true,
		vignette: true,
		aberration: true,
		grain: true,
		grade: true,
		miniature: false,
		lights: 32,
		shadowedTorches: 4,
		sunShadowSize: 2048,
		particles: 4000,
		vegetation: 1,
		fpsCap: 60,
		ambientFps: 30,
		anisotropy: 16,
		antiTile: true,
		paint: 0.5
	},
	ultra: {
		megapixels: 3.7,
		aa: 'traa',
		ao: true,
		bloom: true,
		vignette: true,
		aberration: true,
		grain: true,
		grade: true,
		miniature: false,
		lights: 'clustered',
		shadowedTorches: 4,
		sunShadowSize: 4096,
		particles: 8000,
		vegetation: 1,
		fpsCap: 60,
		ambientFps: 30,
		anisotropy: 16,
		antiTile: true,
		paint: 0.5
	}
};

/** Each layer turns on in the milestone that passes its gates: post-processing, AO and bloom in M63. */
const ON = new Set<Layer>(['ao', 'bloom', 'lens', 'grade', 'dof']);
const LAYERS_ON = Object.fromEntries(LAYERS.map((l) => [l, ON.has(l)])) as Record<Layer, boolean>;

/** The highest tier a backend can run: WebGL2 caps at high, compat WebGPU at low. */
const BACKEND_CEILING: Record<Backend, Tier> = {
	webgpu: 'ultra',
	'webgpu-compat': 'low',
	webgl2: 'high'
};
/** Shells whose webview is weaker than a browser's; #155 fixes the values with measurements. */
const SHELL_CEILING: Partial<Record<Shell, Tier>> = {
	'capacitor-android': 'medium',
	'capacitor-ios': 'medium',
	'tauri-linux': 'medium'
};

const rank = (t: Tier) => TIERS.indexOf(t);
const lower = (a: Tier, b: Tier): Tier => (rank(a) <= rank(b) ? a : b);

/**
 * The starting tier for a device, with no input: software rasterisers and
 * compat WebGPU get low, phones low or medium by memory, integrated GPUs
 * medium, everything else high. Ultra is only ever chosen by hand.
 */
export function qualityFor(caps: Caps): Tier {
	if (caps.software) return 'low';
	let tier: Tier = 'high';
	const memory = caps.deviceMemory ?? 8;
	if (caps.mobile) tier = memory <= 4 ? 'low' : 'medium';
	else if (memory < 4 || (caps.cpuPerformance !== undefined && caps.cpuPerformance <= 1))
		tier = 'low';
	else if (/intel/i.test(caps.vendor ?? '') || /intel/i.test(caps.architecture ?? ''))
		tier = 'medium';
	tier = lower(tier, BACKEND_CEILING[caps.backend]);
	return lower(tier, SHELL_CEILING[caps.shell] ?? 'ultra');
}

/** A tier's settings on a backend (which may hold the tier down). */
export function settingsFor(tier: Tier, backend: Backend): QualitySettings {
	const t = lower(tier, BACKEND_CEILING[backend]);
	return derive(
		{ tier: t, ...ROWS[t], msaa: 0, convergeFrames: 0, layers: { ...LAYERS_ON } },
		backend
	);
}

/**
 * What follows from the antialiasing: MSAA's samples and TRAA's converge frames. Compatibility
 * WebGPU has no MSAA, so SMAA stands in for it.
 */
function derive(s: QualitySettings, backend: Backend): QualitySettings {
	const aa = backend === 'webgpu-compat' && s.aa === 'msaa' ? 'smaa' : s.aa;
	return {
		...s,
		aa,
		msaa: aa === 'msaa' ? 4 : 0,
		convergeFrames: aa === 'traa' ? TRAA_CONVERGE : 0
	};
}

/**
 * The options a viewer may set apart from the preset (the Graphics menu's Advanced), each with the
 * values it offers. Only what the renderer applies today is here.
 */
export const OPTIONS = {
	megapixels: [1, 2.1, 3.7, 8.3],
	aa: AA_MODES,
	ao: [false, true],
	bloom: [false, true],
	vignette: [false, true],
	aberration: [false, true],
	grain: [false, true],
	grade: [false, true],
	miniature: [false, true],
	sunShadowSize: [1024, 2048, 4096],
	fpsCap: [30, 60]
} as const;
export type OptionKey = keyof typeof OPTIONS;
/** The options the viewer changed from their preset. */
export type Overrides = { [K in OptionKey]?: QualitySettings[K] };

/** A preset's settings with the viewer's own options over them (none a backend cannot do). */
export function withOverrides(
	settings: QualitySettings,
	overrides: Overrides,
	backend: Backend
): QualitySettings {
	return derive({ ...settings, ...overrides } as QualitySettings, backend);
}

/** How strongly the Miniature option blurs in play: shots go to 1. */
export const MINIATURE_STRENGTH = 1;

/**
 * How strong depth of field and tilt-shift are this frame (#165): a shot's focus (0 to 1, from
 * `shotFocus`) blurs by depth; the Miniature option does in play, as tilt-shift in the tactical
 * view, which looks nearly straight down. Without depth of field (no prepass) tilt-shift stands
 * in. Reduced motion, or `?off=dof`, keeps both off.
 */
export function lensStrengths(
	s: Pick<QualitySettings, 'miniature' | 'layers'>,
	now: { shot: number; tactical: boolean; hasDof: boolean; reduced: boolean }
): { dof: number; tilt: number } {
	if (now.reduced || !s.layers.dof) return { dof: 0, tilt: 0 };
	const play = s.miniature ? MINIATURE_STRENGTH : 0;
	if (!now.hasDof) return { dof: 0, tilt: Math.max(now.shot, play) };
	if (now.tactical) return { dof: now.shot, tilt: play * (1 - now.shot) };
	return { dof: Math.max(now.shot, play), tilt: 0 };
}

/**
 * Whether the pipeline draws the prepass (post.ts): the overlay's depth when the scene pass has
 * MSAA, the AO's depth and normals, TRAA's depth and velocity. A change of it, or of the
 * antialiasing, builds a new renderer.
 */
export const needsPrepass = (s: Pick<QualitySettings, 'msaa' | 'ao' | 'aa'>) =>
	s.msaa > 0 || s.ao || s.aa === 'traa';

/**
 * Which ambient occlusion the pipeline builds (#159): GTAO on high and ultra, where TRAA resolves
 * its temporal noise; SSAO, self-denoised, wherever else there is a prepass; none without one. A
 * change of it builds a new renderer, as the antialiasing's does.
 */
export function aoKind(s: Pick<QualitySettings, 'tier' | 'msaa' | 'ao' | 'aa'>): AoKind {
	if (!needsPrepass(s)) return 'none';
	return s.aa === 'traa' && (s.tier === 'high' || s.tier === 'ultra') ? 'gtao' : 'ssao';
}
export type AoKind = 'none' | 'ssao' | 'gtao';

/** `?off=sky,grass` turns those layers off; unknown names are ignored. Never saved. */
export function layersFrom(search: string, layers: Record<Layer, boolean>): Record<Layer, boolean> {
	const off = new URLSearchParams(search).get('off');
	if (!off) return layers;
	const out = { ...layers };
	for (const name of off.split(',')) if (name in out) out[name as Layer] = false;
	return out;
}

/** `?tonemap=agx|aces|neutral` (A/B comparisons, #158), or null. Never saved. */
export function toneMapperFrom(search: string): ToneMapper | null {
	const t = new URLSearchParams(search).get('tonemap');
	return TONE_MAPPERS.includes(t as ToneMapper) ? (t as ToneMapper) : null;
}

/** `?tier=low|medium|high|ultra`, or null. Never saved. */
export function tierFrom(search: string): Tier | null {
	const t = new URLSearchParams(search).get('tier');
	return TIERS.includes(t as Tier) ? (t as Tier) : null;
}

/**
 * The pixel ratio that keeps a canvas of `cssW`×`cssH` within `megapixels`:
 * the device's own where that fits, less where it doesn't (4K at DPR 2 on
 * medium draws about 2.1 MP, not 33).
 */
export function pixelRatioFor(cssW: number, cssH: number, dpr: number, megapixels: number): number {
	if (cssW <= 0 || cssH <= 0) return dpr;
	return Math.min(dpr, Math.sqrt((megapixels * 1e6) / (cssW * cssH)));
}

/** Frames a refinement needs before it judges. */
export const REFINE_SAMPLES = 120;

/**
 * After the first active frames: one tier down when the median frame (GPU ms
 * where measured, else main-thread ms) is over `budgetMs`, never up, never
 * below low. Frame rate is never the measure: an idle table draws nothing.
 */
export function refineTier(start: Tier, samples: readonly number[], budgetMs: number): Tier {
	if (samples.length < REFINE_SAMPLES || start === 'low') return start;
	const sorted = [...samples].sort((a, b) => a - b);
	const median = sorted[Math.floor(sorted.length / 2)];
	return median > budgetMs ? TIERS[rank(start) - 1] : start;
}

/**
 * The mip bias of world textures (#179): a little sharper on high and ultra while TRAA resolves
 * the shimmer a negative bias brings, 0 otherwise. A uniform, so a change compiles nothing.
 */
export const mipBiasFor = (s: Pick<QualitySettings, 'tier' | 'aa'>) =>
	s.aa === 'traa' && (s.tier === 'high' || s.tier === 'ultra') ? -0.5 : 0;

/** A frame's budget at a tier: its frame rate's interval. */
export const frameBudgetMs = (s: Pick<QualitySettings, 'fpsCap'>) => 1000 / s.fpsCap;

/** The viewer's graphics settings, kept in this browser. */
export interface GraphicsPrefs {
	/** The preset. `auto`: what the device suggests (or `measured`), else the viewer's choice. */
	tier: 'auto' | Tier;
	/** Options set apart from the preset; choosing a preset clears them. */
	overrides: Overrides;
	/** Forces WebGPURenderer's WebGL2 backend (a reload applies it). */
	compatibility: boolean;
	powerSaver: boolean;
	/** How the picture's light is mapped to the screen: taste, not cost (#158). */
	toneMapper: ToneMapper;
	/** Grid lines at all times, not only while building, placing or aiming a move (#167). */
	alwaysGrid: boolean;
	/** The tier refinement settled on for this device, when `auto`. */
	measured?: Tier;
}

export const DEFAULT_GRAPHICS: GraphicsPrefs = {
	tier: 'auto',
	overrides: {},
	compatibility: false,
	powerSaver: false,
	toneMapper: GRADE_TONE_MAPPER,
	alwaysGrid: false
};

const GRAPHICS_KEY = 'thirdfold:graphics';
const isTier = (v: unknown): v is Tier => TIERS.includes(v as Tier);

/** The saved graphics settings, or the defaults; anything unreadable falls back field by field. */
export function loadGraphics(storage: Pick<Storage, 'getItem'>): GraphicsPrefs {
	try {
		const raw = JSON.parse(storage.getItem(GRAPHICS_KEY) ?? 'null') as unknown;
		if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_GRAPHICS };
		const r = raw as Record<string, unknown>;
		const prefs: GraphicsPrefs = {
			tier: isTier(r.tier) ? r.tier : 'auto',
			overrides: readOverrides(r.overrides),
			compatibility: r.compatibility === true,
			powerSaver: r.powerSaver === true,
			toneMapper: TONE_MAPPERS.includes(r.toneMapper as ToneMapper)
				? (r.toneMapper as ToneMapper)
				: GRADE_TONE_MAPPER,
			alwaysGrid: r.alwaysGrid === true
		};
		if (isTier(r.measured)) prefs.measured = r.measured;
		return prefs;
	} catch {
		return { ...DEFAULT_GRAPHICS };
	}
}

/** Saved options, keeping only known ones with values they offer. */
function readOverrides(raw: unknown): Overrides {
	if (typeof raw !== 'object' || raw === null) return {};
	const out: Record<string, unknown> = {};
	for (const [key, values] of Object.entries(OPTIONS)) {
		const v = (raw as Record<string, unknown>)[key];
		if ((values as readonly unknown[]).includes(v)) out[key] = v;
	}
	return out as Overrides;
}

export function saveGraphics(storage: Pick<Storage, 'setItem'>, prefs: GraphicsPrefs): void {
	try {
		storage.setItem(GRAPHICS_KEY, JSON.stringify(prefs));
	} catch {
		// Private windows and full storage: the settings just aren't remembered.
	}
}

/** The tier to start on: `?tier=`, else the viewer's choice, else what was measured, else the device's. */
export function startingTier(search: string, prefs: GraphicsPrefs, caps: Caps): Tier {
	return (
		tierFrom(search) ?? (prefs.tier !== 'auto' ? prefs.tier : (prefs.measured ?? qualityFor(caps)))
	);
}

/** Losses of the graphics device within this long count together (#150). */
export const LOSS_WINDOW_MS = 5 * 60_000;
/** This many losses within a minute: stop rebuilding and say so. */
export const LOSS_LIMIT = 3;

/**
 * The tier to rebuild at after the graphics device was lost (`losses`, this
 * one included): one lower than `current` for the session, low after a second
 * loss within five minutes, or `stop` after three within a minute. Never
 * saved: a lost device is not a measurement.
 */
export function tierAfterLoss(
	current: Tier,
	losses: readonly number[],
	now: number
): Tier | 'stop' {
	if (losses.filter((t) => now - t <= 60_000).length >= LOSS_LIMIT) return 'stop';
	if (losses.filter((t) => now - t <= LOSS_WINDOW_MS).length >= 2) return 'low';
	return TIERS[Math.max(0, rank(current) - 1)];
}
