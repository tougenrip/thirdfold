<script lang="ts" module>
	import type { Cue } from '$lib/game/chat';
	import type { Motion } from '$lib/game/motion';

	/** A cinematic moment to play once; `seq` (the log entry's) increases so each plays once. */
	export interface CuePlay {
		seq: number;
		/** Every cue among the new log entries, each once (a toll and a flash can come together). */
		cues: Cue[];
		/** The prop to swing (the bell), if this viewer has it on the table. */
		swingPropId: string | null;
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
	import {
		createTabletop,
		type CameraView,
		type HighlightKind,
		type PreviewItem,
		type Tabletop,
		type TabletopEvents
	} from './renderer';

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
		/** The table's dark areas, one byte per cell, or null for none. */
		darkness?: Uint8Array | null;
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
		darkness = null,
		cue = null,
		motion = null,
		active = null,
		onClick,
		onHover
	}: Props = $props();

	let canvas: HTMLCanvasElement;
	let tabletop = $state<Tabletop | null>(null);
	let webglError = $state<string | null>(null);

	$effect(() => {
		try {
			// Handlers read the current props at call time, so the renderer never needs rebuilding.
			const t = createTabletop(canvas, {
				onClick: (pick) => onClick?.(pick),
				onHover: (pick) => onHover?.(pick)
			});
			tabletop = t;
			return () => {
				t.dispose();
				tabletop = null;
			};
		} catch (err) {
			console.error('[tabletop] failed to start renderer', err);
			webglError = 'This browser could not start 3D rendering (WebGL unavailable).';
		}
	});

	$effect(() => {
		tabletop?.setGrid($state.snapshot(grid));
	});

	$effect(() => {
		tabletop?.setTerrain(terrain);
	});

	$effect(() => {
		tabletop?.setDarkness(darkness);
	});

	let lastCue = -1;
	$effect(() => {
		if (!tabletop || !cue || cue.seq <= lastCue) return;
		lastCue = cue.seq;
		for (const c of cue.cues) tabletop.playCue(c, cue.swingPropId);
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

<canvas bind:this={canvas} aria-label="3D tabletop"></canvas>
{#if webglError}
	<p class="webgl-error" role="alert">{webglError}</p>
{/if}

<style>
	canvas {
		display: block;
		width: 100%;
		height: 100%;
		touch-action: none;
	}

	.webgl-error {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		margin: 0;
		color: #f2e6d0;
	}
</style>
