<script lang="ts" module>
	import type { Cue, Shot } from '$lib/game/chat';
	import type { Motion } from '$lib/game/motion';

	/** A cinematic moment to play once; `seq` (the log entry's) increases so each plays once. */
	export interface CuePlay {
		seq: number;
		/** Every cue among the new log entries, each once (a toll and a flash can come together). */
		cues: Cue[];
		/** The prop to swing (the bell), if this viewer has it on the table. */
		swingPropId: string | null;
		/** The camera move the latest of them calls for, if any. */
		shot: Shot | null;
	}

	/** Motions to play once; `seq` increases so each batch plays once. */
	export interface MotionPlay {
		seq: number;
		motions: Motion[];
	}

	/** Combat text to float up from a token once; `id` increases so each shows once. */
	export interface FloatText {
		id: number;
		tokenId: string;
		text: string;
		color: string;
	}
</script>

<script lang="ts">
	import type { GridPos, SquareGrid } from '$lib/game/grid';
	import type { SceneObject } from '$lib/game/objects';
	import type { Token } from '$lib/game/token';
	import type { FogView } from '$lib/game/visibility';
	import type { Ambient, Light } from '$lib/game/lights';
	import type { Prop } from '$lib/game/props';
	import type { DiceThrow } from './dice3d';
	import type { FogMode } from './fog';
	import type { PerfStats } from './perf';
	import type {
		CameraView,
		HighlightKind,
		PreviewItem,
		Tabletop,
		TabletopEvents
	} from './renderer';
	import { loadRenderer } from './load';
	import {
		layersFrom,
		loadGraphics,
		saveGraphics,
		settingsFor,
		startingTier,
		tierAfterLoss,
		tierFrom,
		type Tier
	} from './quality';
	import type { Pose } from './shots';
	import { tick } from 'svelte';

	interface Props extends Partial<TabletopEvents> {
		grid: SquareGrid;
		tokens: readonly Token[];
		objects: readonly SceneObject[];
		fog?: FogView | null;
		ambient?: Ambient;
		lights?: readonly Light[];
		props?: readonly Prop[];
		/** The latest roll to throw as 3D dice; a new `seq` throws again. */
		diceThrow?: DiceThrow | null;
		/** Told how long the dice take to land, so the result can appear as they settle. */
		onDiceThrown?: (seq: number, ms: number) => void;
		selectedPropId?: string | null;
		hoveredPropId?: string | null;
		fogMode?: FogMode;
		hoveredObjectId?: string | null;
		preview?: readonly PreviewItem[];
		selectedId?: string | null;
		highlight?: { cell: GridPos; kind: HighlightKind } | null;
		view?: CameraView;
		/** Tokens drawn lying down (fallen characters). */
		fallen?: readonly string[];
		floats?: readonly FloatText[];
		/** Each cell's level, or null for a flat table. */
		terrain?: Uint8Array | null;
		/** What each cell is made of, or null when nothing is painted. */
		floor?: Uint8Array | null;
		/** The table's dark areas, one byte per cell, or null for none. */
		darkness?: Uint8Array | null;
		/** How the table looks: an environment asset's id, or null for the plain table. */
		environment?: string | null;
		cue?: CuePlay | null;
		motion?: MotionPlay | null;
		/** Whose turn it is in a fight, marked over the token. */
		active?: { tokenId: string; enemy: boolean } | null;
	}

	let {
		grid,
		tokens,
		objects,
		fog = null,
		ambient = 'day',
		lights = [],
		props = [],
		diceThrow = null,
		onDiceThrown,
		selectedPropId = null,
		hoveredPropId = null,
		fogMode = 'player',
		hoveredObjectId = null,
		preview = [],
		selectedId = null,
		highlight = null,
		view = 'tactical',
		fallen = [],
		floats = [],
		terrain = null,
		floor = null,
		darkness = null,
		environment = null,
		cue = null,
		motion = null,
		active = null,
		onClick,
		onHover
	}: Props = $props();

	let canvas = $state<HTMLCanvasElement>();
	let tabletop = $state<Tabletop | null>(null);
	/** `?perf` in the URL: show what rendering costs, and let a measuring script read it. */
	const query = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
	const showPerf = !!query?.has('perf');
	/** `?perf&inspector`: three.js's Inspector too. */
	const showInspector = showPerf && !!query?.has('inspector');
	let perf = $state<PerfStats | null>(null);

	$effect(() => {
		const t = tabletop;
		if (!showPerf || !t) return;
		(window as { thirdfoldPerf?: Tabletop }).thirdfoldPerf = t;
		// Sampling the GPU's timestamps every 500 ms also keeps their query pool from filling up;
		// the overlay shows the last sample rather than waiting for this one.
		const timer = setInterval(() => {
			perf = t.stats();
			void t.sampleGpu();
		}, 500);
		return () => {
			clearInterval(timer);
			delete (window as { thirdfoldPerf?: Tabletop }).thirdfoldPerf;
		};
	});

	const mb = (bytes: number) => (bytes / 2 ** 20).toFixed(1);
	const avg = (label: string) => {
		const t = perf?.timings[label];
		return t && t.count ? (t.total / t.count).toFixed(2) : '–';
	};
	let webglError = $state<string | null>(null);
	/** Drawn by a software rasteriser (no GPU): the table shows at the low tier. */
	let softwareNotice = $state(false);

	/**
	 * Bumped to make the tabletop again on a fresh canvas: after the WebGL context or WebGPU
	 * device was lost, or for a tier that turns MSAA on or off (fixed for a renderer's life).
	 * Every effect below replays its prop into the new tabletop; one-shot cues don't replay.
	 */
	let generation = $state(0);
	/** A new tabletop is being made after a loss: "Restoring the table…" until it draws. */
	let restoring = $state(false);
	/** Lost twice within five minutes: drawn at low for the rest of the session. */
	let lossNotice = $state(false);
	/** A tier for this session only, after a loss (never saved: a loss is not a measurement). */
	let sessionTier: Tier | null = null;
	const losses: number[] = [];
	/** The last tabletop's disposal: the next one waits for it. */
	let lastDisposal: Promise<void> = Promise.resolve();
	/** Where the camera was on the tabletop being replaced. */
	let carriedPose: Pose | null = null;
	/** MSAA for the next tabletop: from the tier where it is known before the device is. */
	let antialias = initialAntialias();

	function initialAntialias(): boolean {
		if (typeof location === 'undefined') return true;
		const prefs = loadGraphics(localStorage);
		const known =
			tierFrom(location.search) ?? (prefs.tier !== 'auto' ? prefs.tier : prefs.measured);
		return known ? settingsFor(known, 'webgpu').msaa > 0 : true;
	}

	/** Makes the tabletop again on a fresh canvas, the camera where it was. */
	function rebuild(t: Tabletop): void {
		carriedPose = t.cameraPose();
		generation++;
	}

	/** The graphics device was lost: rebuild (a tier lower), once the page can be seen. */
	function lost(t: Tabletop): void {
		const now = Date.now();
		losses.push(now);
		const next = tierAfterLoss((t.stats().tier as Tier | null) ?? 'medium', losses, now);
		if (next === 'stop') {
			tabletop = null;
			lastDisposal = t.dispose();
			webglError = "The table's graphics keep failing. Reload the page to try again.";
			return;
		}
		sessionTier = next;
		lossNotice = losses.filter((at) => now - at <= 5 * 60_000).length >= 2;
		restoring = true;
		// A backgrounded app can't draw: wait until it is back.
		if (document.visibilityState !== 'hidden') return rebuild(t);
		document.addEventListener('visibilitychange', () => rebuild(t), { once: true });
	}

	/**
	 * The quality tier to draw at (quality.ts): `?tier=`, else the viewer's choice, else what an
	 * earlier session measured, else what the device suggests; `?off=` turns layers off. Neither
	 * URL switch is saved. An automatic tier may step down once after the first active frames.
	 */
	function applyQuality(t: Tabletop, tier: Tier | null = null): boolean {
		const search = location.search;
		const prefs = loadGraphics(localStorage);
		const caps = t.capabilities();
		const auto = !tierFrom(search) && prefs.tier === 'auto' && !sessionTier;
		const chosen = tier ?? sessionTier ?? startingTier(search, prefs, caps);
		const settings = settingsFor(chosen, caps.backend);
		// MSAA can't change on a renderer: make a new one with the tier's.
		if (settings.msaa > 0 !== antialias) {
			antialias = settings.msaa > 0;
			rebuild(t);
			return false;
		}
		t.setQuality({ ...settings, layers: layersFrom(search, settings.layers) }, auto && !tier);
		t.setPowerSaver(prefs.powerSaver);
		softwareNotice = caps.software;
		return true;
	}

	/** Calls `done` once `t` has drawn a frame (unless `gone` first). */
	function whenDrawn(t: Tabletop, gone: () => boolean, done: () => void): void {
		const check = () => {
			if (gone()) return;
			if (t.stats().frames > 0) done();
			else requestAnimationFrame(check);
		};
		check();
	}

	/** Refinement stepped the automatic tier down: remember it for this device, and use it. */
	function tierRefined(t: Tabletop, tier: Tier): void {
		saveGraphics(localStorage, { ...loadGraphics(localStorage), measured: tier });
		applyQuality(t, tier);
	}

	$effect(() => {
		// Each generation has its own canvas ({#key} below), and gets its own tabletop.
		const el = canvas;
		if (!el) return;
		// three.js and the renderer come in their own chunk, so the page around the table
		// (and the join form before it) doesn't wait for them.
		let t: Tabletop | null = null;
		let gone = false;
		// The last tabletop must be gone first: two renderers tearing down and starting up at once
		// break each other's drawing (a rebuild after a loss, a new MSAA, #151).
		Promise.all([loadRenderer(), lastDisposal])
			.then(async ([{ createTabletop }]) => {
				if (gone) return;
				// Handlers read the current props at call time, so the renderer never needs rebuilding.
				const made = await createTabletop(
					el,
					{ onClick: (pick) => onClick?.(pick), onHover: (pick) => onHover?.(pick) },
					{
						perf: showPerf,
						inspector: showInspector,
						antialias,
						onTierRefined: (tier) => t && tierRefined(t, tier),
						onLost: () => t && lost(t)
					}
				);
				// Unmounted (or replaced) while the renderer was starting: throw it away.
				if (gone || !applyQuality(made)) {
					lastDisposal = made.dispose();
					return;
				}
				t = made;
				tabletop = t;
				// The effects below replay the table into it; then the camera goes back where it was.
				const pose = carriedPose;
				carriedPose = null;
				if (pose) void tick().then(() => made.setPose(pose));
				if (restoring)
					whenDrawn(
						made,
						() => gone,
						() => (restoring = false)
					);
			})
			.catch((err) => {
				console.error('[tabletop] failed to start renderer', err);
				webglError = /webgl|webgpu|context|adapter/i.test(String(err))
					? "This device can't show 3D (WebGL2 unavailable)."
					: "The table couldn't start.";
			});
		return () => {
			gone = true;
			if (t) lastDisposal = t.dispose();
			tabletop = null;
		};
	});

	$effect(() => {
		tabletop?.setGrid($state.snapshot(grid));
	});

	$effect(() => {
		tabletop?.setTerrain(terrain);
	});

	$effect(() => {
		tabletop?.setFloor(floor);
	});

	$effect(() => {
		tabletop?.setDarkness(darkness);
	});

	$effect(() => {
		tabletop?.setEnvironment(environment);
	});

	let lastCue = -1;
	$effect(() => {
		if (!tabletop || !cue || cue.seq <= lastCue) return;
		lastCue = cue.seq;
		for (const c of cue.cues) tabletop.playCue(c, cue.swingPropId);
		if (cue.shot) tabletop.playShot(cue.shot);
	});

	$effect(() => {
		// Snapshot reads every field, so any token change re-runs this; the layer diffs.
		tabletop?.setTokens($state.snapshot(tokens) as Token[]);
	});

	$effect(() => {
		tabletop?.setObjects($state.snapshot(objects) as SceneObject[]);
	});

	$effect(() => {
		tabletop?.setFog(fog ? { ...fog } : null, fogMode);
	});

	$effect(() => {
		tabletop?.setLighting(ambient, $state.snapshot(lights) as Light[]);
	});

	$effect(() => {
		tabletop?.setProps($state.snapshot(props) as Prop[]);
	});

	let thrownSeq = -1;
	$effect(() => {
		if (!tabletop || !diceThrow || diceThrow.seq === thrownSeq) return;
		thrownSeq = diceThrow.seq;
		const ms = tabletop.throwDice($state.snapshot(diceThrow) as DiceThrow);
		onDiceThrown?.(diceThrow.seq, ms);
	});

	$effect(() => {
		tabletop?.setSelectedProp(selectedPropId);
	});

	$effect(() => {
		tabletop?.setHoveredProp(hoveredPropId);
	});

	$effect(() => {
		tabletop?.setHoveredObject(hoveredObjectId);
	});

	$effect(() => {
		tabletop?.setPreview($state.snapshot(preview) as PreviewItem[]);
	});

	$effect(() => {
		tabletop?.setSelected(selectedId);
	});

	$effect(() => {
		tabletop?.setHighlight(highlight?.cell ?? null, highlight?.kind ?? 'move');
	});

	$effect(() => {
		tabletop?.setView(view);
	});

	$effect(() => {
		tabletop?.setFallen([...fallen]);
	});

	let floatedId = 0;
	$effect(() => {
		if (!tabletop) return;
		for (const f of floats) {
			if (f.id <= floatedId) continue;
			floatedId = f.id;
			tabletop.showFloat(f.tokenId, f.text, f.color);
		}
	});

	$effect(() => {
		tabletop?.setActive(active?.tokenId ?? null, active?.enemy ?? false);
	});

	// After the props: a motion may be for a prop that has only just arrived.
	let lastMotion = -1;
	$effect(() => {
		if (!tabletop || !motion || motion.seq <= lastMotion) return;
		lastMotion = motion.seq;
		tabletop.playMotions($state.snapshot(motion.motions) as Motion[]);
	});
</script>

<!-- Focusable so the arrow keys can move the selected token (RoomView listens). A fresh canvas
     for each tabletop: a lost context stays lost on its canvas, and a canvas keeps its kind. -->
{#key generation}
	<canvas
		bind:this={canvas}
		tabindex="0"
		aria-label="3D tabletop. Select a token, then use the arrow keys to move it one cell."
	></canvas>
{/key}
{#if restoring}
	<p class="restoring" role="status">Restoring the table…</p>
{/if}
{#if lossNotice}
	<p class="software-notice" role="status">
		The graphics device was lost twice: the table is drawn at low quality for now.
		<button type="button" onclick={() => (lossNotice = false)} aria-label="Dismiss">×</button>
	</p>
{/if}
{#if perf}
	<dl class="perf" aria-label="Rendering performance">
		<dt>backend</dt>
		<dd>{perf.backend}{perf.compat ? ' (compat)' : ''}</dd>
		<dt>adapter</dt>
		<dd class="adapter" title={perf.adapter ?? ''}>{perf.adapter ?? '–'}</dd>
		<dt>tier / mode</dt>
		<dd>{perf.tier ?? '–'} / {perf.mode ?? '–'}</dd>
		<dt>fps</dt>
		<dd>{perf.fps}</dd>
		<dt>frame ms</dt>
		<dd>{avg('frame')} (max {perf.timings.frame?.max.toFixed(1) ?? '–'})</dd>
		<dt>GPU ms</dt>
		<dd>{perf.gpuMs === null ? 'n/a' : perf.gpuMs.toFixed(2)}</dd>
		<dt>draws</dt>
		<dd>{perf.drawCalls}</dd>
		<dt>triangles</dt>
		<dd>{perf.triangles.toLocaleString()}</dd>
		<dt>geo / tex / prog</dt>
		<dd>{perf.geometries} / {perf.textures} / {perf.programs}</dd>
		<dt>memory MB</dt>
		<dd>{mb(perf.memoryBytes)} (tex {mb(perf.texturesBytes)})</dd>
		<dt>lighting ms</dt>
		<dd>{avg('lighting')} ×{perf.timings.lighting?.count ?? 0}</dd>
	</dl>
{/if}
{#if softwareNotice}
	<p class="software-notice" role="status">
		No graphics card in use: the table is drawn in software, at low quality.
		<button type="button" onclick={() => (softwareNotice = false)} aria-label="Dismiss">×</button>
	</p>
{/if}
{#if webglError}
	<div class="webgl-error" role="alert">
		<p class="title">The table can’t be shown here</p>
		<p>{webglError}</p>
		<p>
			You’re still at the table: chat, dice and the panels work. To see it, turn on hardware
			acceleration in your browser’s settings, or open this link in another browser.
		</p>
	</div>
{/if}

<style>
	canvas {
		display: block;
		width: 100%;
		height: 100%;
		touch-action: none;
	}

	.perf {
		position: absolute;
		left: 0.5rem;
		bottom: 0.5rem;
		display: grid;
		grid-template-columns: auto auto;
		gap: 0 var(--sp-4);
		margin: 0;
		padding: var(--sp-3) var(--sp-4);
		font-family: var(--font-mono);
		font-size: var(--fs-2xs);
		line-height: 1.4;
		font-variant-numeric: tabular-nums;
		color: var(--glow);
		background: var(--scrim);
		pointer-events: none;
		z-index: var(--z-overlay);
	}

	.perf dd {
		margin: 0;
	}

	.perf .adapter {
		max-width: 24ch;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.restoring {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		margin: 0;
		font-size: var(--fs-sm);
		color: var(--glow);
		background: var(--scrim);
		z-index: var(--z-overlay);
	}

	.software-notice {
		position: absolute;
		left: 50%;
		bottom: var(--sp-4);
		transform: translateX(-50%);
		display: flex;
		align-items: center;
		gap: var(--sp-3);
		margin: 0;
		padding: var(--sp-2) var(--sp-4);
		font-size: var(--fs-xs);
		color: var(--glow);
		background: var(--scrim);
		border-radius: var(--radius-pill);
		z-index: var(--z-overlay);
	}

	.software-notice button {
		all: unset;
		cursor: pointer;
		padding-inline: var(--sp-1);
	}

	/* Centred in the free space between the room's chat and side panels. */
	.webgl-error {
		position: absolute;
		top: 50%;
		left: var(--free-left, 1rem);
		right: var(--free-right, 1rem);
		transform: translateY(-50%);
		margin-inline: auto;
		width: min(28rem, calc(100% - var(--free-left, 1rem) - var(--free-right, 1rem)));
		display: grid;
		gap: var(--sp-3);
		padding: var(--sp-6) var(--sp-7);
		background: var(--panel-solid);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-md);
		color: var(--muted);
	}

	.webgl-error p {
		margin: 0;
		max-width: 65ch;
	}

	.webgl-error .title {
		font-family: var(--font-display);
		font-size: var(--fs-lg);
		font-weight: 700;
		color: var(--text);
	}
</style>
