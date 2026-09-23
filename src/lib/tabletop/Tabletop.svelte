<script lang="ts">
	import type { SquareGrid } from '$lib/game/grid';
	import { createTabletop, type CameraView, type Tabletop } from './renderer';

	let { grid, view = 'tactical' }: { grid: SquareGrid; view?: CameraView } = $props();

	let canvas: HTMLCanvasElement;
	let tabletop = $state<Tabletop | null>(null);
	let webglError = $state<string | null>(null);

	$effect(() => {
		try {
			const t = createTabletop(canvas);
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
		tabletop?.setGrid(grid);
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
