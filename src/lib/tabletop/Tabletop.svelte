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

	let canvas: HTMLCanvasElement;
	let tabletop = $state<Tabletop | null>(null);
	/** `?perf` in the URL: show what rendering costs, and let a measuring script read it. */
	const showPerf =
		typeof location !== 'undefined' && new URLSearchParams(location.search).has('perf');
	let perf = $state<PerfStats | null>(null);

	$effect(() => {
		const t = tabletop;
		if (!showPerf || !t) return;
		(window as { thirdfoldPerf?: Tabletop }).thirdfoldPerf = t;
		const timer = setInterval(() => (perf = t.stats()), 500);
		return () => {
			clearInterval(timer);
			delete (window as { thirdfoldPerf?: Tabletop }).thirdfoldPerf;
		};
	});

	const avg = (label: string) => {
		const t = perf?.timings[label];
		return t && t.count ? (t.total / t.count).toFixed(2) : '–';
	};
	let webglError = $state<string | null>(null);

	$effect(() => {
		// three.js and the renderer come in their own chunk, so the page around the table
		// (and the join form before it) doesn't wait for them.
		let t: Tabletop | null = null;
		let gone = false;
		loadRenderer()
			.then(({ createTabletop }) => {
				if (gone) return;
				// Handlers read the current props at call time, so the renderer never needs rebuilding.
				t = createTabletop(canvas, {
					onClick: (pick) => onClick?.(pick),
					onHover: (pick) => onHover?.(pick)
				});
				tabletop = t;
			})
			.catch((err) => {
				console.error('[tabletop] failed to start renderer', err);
				webglError = 'This browser could not start 3D rendering (WebGL unavailable).';
			});
		return () => {
			gone = true;
			t?.dispose();
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

<!-- Focusable so the arrow keys can move the selected token (RoomView listens). -->
<canvas
	bind:this={canvas}
	tabindex="0"
	aria-label="3D tabletop. Select a token, then use the arrow keys to move it one cell."
></canvas>
{#if perf}
	<dl class="perf" aria-label="Rendering performance">
		<dt>fps</dt>
		<dd>{perf.fps}</dd>
		<dt>frame ms</dt>
		<dd>{avg('frame')} (max {perf.timings.frame?.max.toFixed(1) ?? '–'})</dd>
		<dt>draws</dt>
		<dd>{perf.drawCalls}</dd>
		<dt>triangles</dt>
		<dd>{perf.triangles.toLocaleString()}</dd>
		<dt>geo / tex / prog</dt>
		<dd>{perf.geometries} / {perf.textures} / {perf.programs}</dd>
		<dt>lighting ms</dt>
		<dd>{avg('lighting')} ×{perf.timings.lighting?.count ?? 0}</dd>
	</dl>
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
