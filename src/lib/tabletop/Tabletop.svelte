<script lang="ts">
	import type { GridPos, SquareGrid } from '$lib/game/grid';
	import type { SceneObject } from '$lib/game/objects';
	import type { Token } from '$lib/game/token';
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
		hoveredObjectId?: string | null;
		preview?: readonly PreviewItem[];
		selectedId?: string | null;
		highlight?: { cell: GridPos; kind: HighlightKind } | null;
		view?: CameraView;
	}

	let {
		grid,
		tokens,
		objects,
		hoveredObjectId = null,
		preview = [],
		selectedId = null,
		highlight = null,
		view = 'tactical',
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
		// Snapshot reads every field, so any token change re-runs this; the layer diffs.
		tabletop?.setTokens($state.snapshot(tokens) as Token[]);
	});

	$effect(() => {
		tabletop?.setObjects($state.snapshot(objects) as SceneObject[]);
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
