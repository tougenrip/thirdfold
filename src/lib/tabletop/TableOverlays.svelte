<script lang="ts">
	import type { PerfStats } from './perf';

	/**
	 * What shows over the table besides the table (Tabletop.svelte): the `?perf` overlay, the
	 * "Restoring the table…" cover after a lost device, the notices for a lost device and for
	 * software rendering (dismissable), and the panel when the table can't be shown at all.
	 */
	let {
		perf,
		restoring,
		lossNotice = $bindable(),
		softwareNotice = $bindable(),
		webglError
	}: {
		perf: PerfStats | null;
		restoring: boolean;
		lossNotice: boolean;
		softwareNotice: boolean;
		webglError: string | null;
	} = $props();

	const mb = (bytes: number) => (bytes / 2 ** 20).toFixed(1);
	const avg = (label: string) => {
		const t = perf?.timings[label];
		return t && t.count ? (t.total / t.count).toFixed(2) : '–';
	};
</script>

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
