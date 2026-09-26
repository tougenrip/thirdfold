// Quality tiers (milestone 62, #147): what a device can do (`Caps`) becomes a
// starting tier, and each tier one row of settings every effect reads, so no
// milestone invents its own switch. Pure: no three.js, no DOM (capabilities.ts
// probes the browser). `?tier=` and `?off=` override for A/B tests and
// emergencies and are never saved; the viewer's own choice is kept in
// `thirdfold:graphics`, in this browser only.

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
export const LAYERS = ['sky', 'post', 'grass', 'water', 'vfx', 'weather', 'xray', 'dof'] as const;
export type Layer = (typeof LAYERS)[number];

export interface QualitySettings {
	tier: Tier;
	/** Internal resolution cap, in megapixels (the drawing buffer, not CSS pixels). */
	megapixels: number;
	/** Antialiasing: MSAA samples (applied through a renderer rebuild, #150). */
	msaa: 0 | 4;
	ao: boolean;
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
	/** Frames a still picture takes to converge (TRAA, later). */
	convergeFrames: number;
	layers: Record<Layer, boolean>;
}

const ROWS: Record<Tier, Omit<QualitySettings, 'tier' | 'layers'>> = {
	low: {
		megapixels: 1.0,
		msaa: 0,
		ao: false,
		lights: 8,
		shadowedTorches: 0,
		sunShadowSize: 1024,
		particles: 250,
		vegetation: 0.25,
		fpsCap: 30,
		ambientFps: 20,
		convergeFrames: 0
	},
	medium: {
		megapixels: 2.1,
		msaa: 4,
		ao: true,
		lights: 16,
		shadowedTorches: 2,
		sunShadowSize: 2048,
		particles: 1000,
		vegetation: 0.5,
		fpsCap: 60,
		ambientFps: 30,
		convergeFrames: 4
	},
	high: {
		megapixels: 3.7,
		msaa: 4,
		ao: true,
		lights: 32,
		shadowedTorches: 4,
		sunShadowSize: 2048,
		particles: 4000,
		vegetation: 1,
		fpsCap: 60,
		ambientFps: 30,
		convergeFrames: 8
	},
	ultra: {
		megapixels: 3.7,
		msaa: 4,
		ao: true,
		lights: 'clustered',
		shadowedTorches: 4,
		sunShadowSize: 4096,
		particles: 8000,
		vegetation: 1,
		fpsCap: 60,
		ambientFps: 30,
		convergeFrames: 16
	}
};

/** No layer exists yet: each turns on in the milestone that passes its gates. */
const LAYERS_ON: Record<Layer, boolean> = Object.fromEntries(
	LAYERS.map((l) => [l, false])
) as Record<Layer, boolean>;

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
	return { tier: t, ...ROWS[t], layers: { ...LAYERS_ON } };
}

/** `?off=sky,grass` turns those layers off; unknown names are ignored. Never saved. */
export function layersFrom(search: string, layers: Record<Layer, boolean>): Record<Layer, boolean> {
	const off = new URLSearchParams(search).get('off');
	if (!off) return layers;
	const out = { ...layers };
	for (const name of off.split(',')) if (name in out) out[name as Layer] = false;
	return out;
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

/** A frame's budget at a tier: its frame rate's interval. */
export const frameBudgetMs = (s: Pick<QualitySettings, 'fpsCap'>) => 1000 / s.fpsCap;

/** The viewer's graphics settings, kept in this browser. */
export interface GraphicsPrefs {
	/** `auto`: what the device suggests (or `measured`), else the viewer's choice. */
	tier: 'auto' | Tier;
	/** Forces WebGPURenderer's WebGL2 backend (a reload applies it). */
	compatibility: boolean;
	powerSaver: boolean;
	/** The tier refinement settled on for this device, when `auto`. */
	measured?: Tier;
}

export const DEFAULT_GRAPHICS: GraphicsPrefs = {
	tier: 'auto',
	compatibility: false,
	powerSaver: false
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
			compatibility: r.compatibility === true,
			powerSaver: r.powerSaver === true
		};
		if (isTier(r.measured)) prefs.measured = r.measured;
		return prefs;
	} catch {
		return { ...DEFAULT_GRAPHICS };
	}
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
