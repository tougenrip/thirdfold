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
	import type { WorldLook } from '$lib/game/world';
	import type { Prop } from '$lib/game/props';
	import type { DiceThrow } from './dice3d';
	import type { FogMode } from './fog';
	import type { PerfStats } from './perf';
	import type { CameraView, HighlightKind, PreviewItem, Tabletop, TabletopEvents } from './types';
	import { loadRenderer, takeWarmRenderer } from './load';
	import TableOverlays from './TableOverlays.svelte';
	import TableLoading from './TableLoading.svelte';
	import {
		layersFrom,
		loadGraphics,
		saveGraphics,
		settingsFor,
		startingTier,
		tierAfterLoss,
		tierFrom,
		withOverrides,
		toneMapperFrom,
		type Backend,
		type GraphicsPrefs,
		type Tier
	} from './quality';
	import { initialShape, sameShape, shapeOf, type Shape } from './shape';
	import { reducesFlashing } from './flash';
	import { prefersReducedMotion } from 'svelte/motion';
	import { textureDetailFrom } from '$lib/assets/detail';
	import type { Pose } from './shots';
	import type { Ring } from './bases';
	import { tick, untrack } from 'svelte';

	interface Props extends Partial<TabletopEvents> {
		grid: SquareGrid;
		tokens: readonly Token[];
		objects: readonly SceneObject[];
		fog?: FogView | null;
		ambient?: Ambient;
		/** The world's look: its hour blends the lighting presets (#208); null for the band's alone. */
		world?: WorldLook | null;
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
		ownTokens?: readonly string[]; // the viewer's own, whose roofs fade as the selected one's (#259)
		hoveredTokenId?: string | null; // its base's ring brightens (#265)
		rings?: ReadonlyMap<string, Ring>; // each token's ring (#265, `ringsFor`)
		highlight?: { cell: GridPos; kind: HighlightKind } | null;
		/** The grid's mode (with the viewer's Grid setting) and explore mode's focus (#245). */
		gridView?: Parameters<Tabletop['setGridMode']>;
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
		/** The roofed cells, one byte per cell, or null for none. */
		interior?: Uint8Array | null;
		/** How the table looks: an environment asset's id, or null for the plain table. */
		environment?: string | null;
		cue?: CuePlay | null;
		motion?: MotionPlay | null;
		/** Whose turn it is in a fight, marked over the token. */
		active?: { tokenId: string; enemy: boolean } | null;
		/** The names to show besides the selected and active tokens' (#268): hovered, or all. */
		labels?: { hovered: string | null; held: boolean };
		/** The viewer's graphics settings (the Graphics menu); read from storage when not given. */
		graphics?: GraphicsPrefs | null;
		/** Told the tier and backend the table draws with, whenever they change. */
		onQuality?: (effective: { tier: Tier; backend: Backend }) => void;
	}

	let {
		grid,
		tokens,
		objects,
		fog = null,
		ambient = 'day',
		world = null,
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
		ownTokens = [],
		hoveredTokenId = null,
		rings = new Map(),
		highlight = null,
		gridView = ['off'],
		view = 'tactical',
		fallen = [],
		floats = [],
		terrain = null,
		floor = null,
		darkness = null,
		interior = null,
		environment = null,
		cue = null,
		motion = null,
		active = null,
		labels = { hovered: null, held: false },
		graphics = null,
		onQuality,
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

	let webglError = $state<string | null>(null);
	/** Drawn by a software rasteriser (no GPU): the table shows at the low tier. */
	let softwareNotice = $state(false);

	/**
	 * Bumped to make the tabletop again on a fresh canvas: after the WebGL context or WebGPU
	 * device was lost, or for a tier that turns MSAA on or off (fixed for a renderer's life).
	 * Every effect below replays its prop into the new tabletop; one-shot cues don't replay.
	 */
	let generation = $state(0);
	/** Lost twice within five minutes: drawn at low for the rest of the session. */
	let lossNotice = $state(false);
	/** This session's tier: after a loss (never saved), or the refined one a rebuild keeps. */
	let sessionTier: Tier | null = null;
	const losses: number[] = [];
	/** The last tabletop's disposal: the next one waits for it. */
	let lastDisposal: Promise<void> = Promise.resolve();
	/** Only the first tabletop may adopt the lobby's renderer: later ones are rebuilds. */
	let firstTabletop = true;
	/** Where the camera was on the tabletop being replaced. */
	let carriedPose: Pose | null = null;
	/**
	 * MSAA, whether the pipeline has a prepass, the antialiasing and the AO, for the next tabletop:
	 * from the settings where they are known before the device is. A change of any builds a new
	 * renderer.
	 */
	let shape: Shape = initialShape();

	/** Makes the tabletop again on a fresh canvas, the camera where it was. */
	function rebuild(t: Tabletop): void {
		// A tabletop replaced before it was shown (its shape did not fit) passes on the pose still
		// waiting for it, not its own.
		carriedPose ??= t.cameraPose();
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
		const prefs = graphics ?? loadGraphics(localStorage);
		appliedGraphics = graphics;
		const caps = t.capabilities();
		const auto = !tierFrom(search) && prefs.tier === 'auto' && !sessionTier;
		const chosen = tier ?? sessionTier ?? startingTier(search, prefs, caps);
		const settings = withOverrides(
			settingsFor(chosen, caps.backend),
			prefs.overrides,
			caps.backend
		);
		// MSAA and the prepass make the pipeline's shape: a new one gets a new renderer, since
		// rebuilding passes on the same one left their old shaders behind.
		if (!sameShape(shapeOf(settings), shape)) {
			shape = shapeOf(settings);
			rebuild(t);
			return false;
		}
		const toneMapper = toneMapperFrom(search) ?? prefs.toneMapper;
		const textureDetail = textureDetailFrom(search) ?? settings.textureDetail;
		t.setQuality(
			{ ...settings, layers: layersFrom(search, settings.layers), toneMapper, textureDetail },
			auto && !tier
		);
		t.setPowerSaver(prefs.powerSaver);
		softwareNotice = caps.software;
		onQuality?.({ tier: settings.tier, backend: caps.backend });
		return true;
	}

	/** The graphics settings last applied: a new choice from the menu applies at once. */
	let appliedGraphics: GraphicsPrefs | null = null;
	$effect(() => {
		const g = graphics;
		const t = tabletop;
		if (!t || g === appliedGraphics) return;
		// The viewer's own choice replaces a tier dropped after a lost device.
		sessionTier = null;
		untrack(() => applyQuality(t));
	});

	/** Refinement stepped the automatic tier down: remember it for this device, and use it. */
	function tierRefined(t: Tabletop, tier: Tier): void {
		saveGraphics(localStorage, { ...loadGraphics(localStorage), measured: tier });
		applyQuality(t, (sessionTier = tier)); // its new shape's rebuild keeps it (`graphics` is older)
	}

	$effect(() => {
		// Each generation has its own canvas ({#key} below), and gets its own tabletop.
		const el = canvas;
		if (!el) return;
		// three.js and the renderer come in their own chunk, so the page around the table
		// (and the join form before it) doesn't wait for them.
		let t: Tabletop | null = null;
		let gone = false;
		/** The lobby's canvas, drawn on in this one's place. */
		let adopted: HTMLCanvasElement | null = null;
		// The first tabletop takes the renderer the lobby warmed up, if any (#180).
		const warmed = firstTabletop ? takeWarmRenderer() : null;
		firstTabletop = false;
		// The last tabletop must be gone first: two renderers tearing down and starting up at once
		// break each other's drawing (a rebuild after a loss, a new MSAA, #151).
		Promise.all([loadRenderer(), lastDisposal, warmed])
			.then(async ([{ createTabletop }, , lobby]) => {
				// One of another pipeline's shape, or timed (`?perf`), is no use: throw it away.
				const warm = lobby && !gone && !showPerf && sameShape(lobby.shape, shape) ? lobby : null;
				if (lobby && !warm) lobby.renderer.dispose();
				if (gone) return;
				if (warm) {
					for (const { name, value } of el.attributes) warm.canvas.setAttribute(name, value);
					el.replaceWith((adopted = warm.canvas));
				}
				// Handlers read the current props at call time, so the renderer never needs rebuilding.
				const made = await createTabletop(
					adopted ?? el,
					{ onClick: (pick) => onClick?.(pick), onHover: (pick) => onHover?.(pick) },
					{
						perf: showPerf,
						inspector: showInspector,
						antialias: shape.antialias,
						warm: warm ?? undefined,
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
			// Its own canvas left the page with the block that made it; this one was put in its place.
			adopted?.remove();
		};
	});

	$effect(() => {
		tabletop?.setGrid($state.snapshot(grid));
	});

	$effect(() => tabletop?.setTerrain(terrain));

	$effect(() => tabletop?.setFloor(floor));

	$effect(() => tabletop?.setDarkness(darkness));

	$effect(() => tabletop?.setInterior(interior));

	$effect(() => tabletop?.setEnvironment(environment));

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
		tabletop?.setLighting(
			ambient,
			$state.snapshot(lights) as Light[],
			$state.snapshot(world) as WorldLook | null
		);
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

	$effect(() => tabletop?.setSelectedProp(selectedPropId));

	$effect(() => tabletop?.setHoveredProp(hoveredPropId));

	$effect(() => tabletop?.setHoveredObject(hoveredObjectId));

	$effect(() => {
		tabletop?.setPreview($state.snapshot(preview) as PreviewItem[]);
	});

	$effect(() => tabletop?.setSelected(selectedId));

	$effect(() => tabletop?.setOwnTokens([...ownTokens]));
	$effect(() => tabletop?.setHoveredToken(hoveredTokenId));
	$effect(() => tabletop?.setRings(rings));

	$effect(() => {
		tabletop?.setHighlight(highlight?.cell ?? null, highlight?.kind ?? 'move');
	});

	$effect(() => {
		tabletop?.setGridMode(gridView[0], $state.snapshot(gridView[1]));
	});

	/** Reduce flashing (#223): `auto` follows the device's reduced motion, live. */
	$effect(() => {
		const setting = (graphics ?? untrack(() => loadGraphics(localStorage))).reduceFlashing;
		tabletop?.setReduceFlashing(reducesFlashing(setting, prefersReducedMotion.current));
	});

	$effect(() => tabletop?.setView(view));

	$effect(() => tabletop?.setFallen([...fallen]));

	let floatedId = 0;
	$effect(() => {
		if (!tabletop) return;
		for (const f of floats) {
			if (f.id <= floatedId) continue;
			floatedId = f.id;
			tabletop.showFloat(f.tokenId, f.text, f.color);
		}
	});

	$effect(() => tabletop?.setActive(active?.tokenId ?? null, active?.enemy ?? false));

	$effect(() => {
		const always = (graphics ?? untrack(() => loadGraphics(localStorage))).names === true;
		tabletop?.setLabels({ ...labels, always });
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
{#if !webglError}
	<TableLoading {tabletop} table="{grid.width}x{grid.height} {environment}" />
{/if}
<TableOverlays {perf} bind:lossNotice bind:softwareNotice {webglError} />

<style>
	canvas {
		display: block;
		width: 100%;
		height: 100%;
		touch-action: none;
	}
</style>
