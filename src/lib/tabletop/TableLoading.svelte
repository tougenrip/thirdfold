<script lang="ts">
	import type { Tabletop } from './types';

	/**
	 * The cover over the table while it loads (Tabletop.svelte): from the renderer starting until
	 * the first view's loads have settled, its shaders are warm and it has come to rest, then it
	 * lifts away. Again, quicker, for a new table (`table` changes: travel, a load) and a rebuilt
	 * renderer (`tabletop` goes and comes back).
	 */
	let { tabletop, table }: { tabletop: Tabletop | null; table: string } = $props();

	const STAGES = ['Setting the table', 'Placing the pieces', 'Warming the lights'];
	let stage = $state(0);
	let loads = $state<[number, number]>([0, 0]);
	let ready = $state(false);
	/** Shown once already: later covers lift quicker. */
	let quick = $state(false);

	$effect(() => {
		const t = tabletop;
		void table;
		ready = false;
		stage = 0;
		if (!t) return;
		// Loads settled before now were the last table's.
		const [before] = t.loads();
		const started = performance.now();
		let timer = 0;
		const poll = () => {
			const [done, all] = t.loads();
			const s = t.stats();
			loads = [done - before, all - before];
			stage = done < all ? 1 : 2;
			// ponytail: gives up after 30 s (a table that never rests, a stalled download).
			const calm = !s.holding && s.frames > 0 && (s.mode === 'idle' || s.mode === 'ambient');
			if ((done === all && calm) || performance.now() - started > 30_000) ready = true;
			else timer = window.setTimeout(poll, 100);
		};
		poll();
		return () => clearTimeout(timer);
	});

	/** Lifts away: fades, grows a touch and blurs; only fades under reduced motion. */
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	function lift(_: Element) {
		const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
		const duration = still ? 250 : quick ? 450 : 800;
		quick = true;
		return {
			duration,
			easing: (p: number) => 1 - (1 - p) ** 3,
			css: (t: number, u: number) =>
				still
					? `opacity:${t}`
					: `opacity:${t};transform:scale(${1 + u * 0.04});filter:blur(${u * 6}px)`
		};
	}
</script>

{#if !ready}
	<div class="loading" out:lift>
		<svg viewBox="0 0 32 32" aria-hidden="true">
			<g>
				<path d="M16 3v3M9 23c0-9 2.5-15 7-15s7 6 7 15M6.5 23h19" />
				<circle cx="16" cy="26" r="1.8" />
			</g>
		</svg>
		<p class="stage" role="status">
			{stage === 0 && quick ? 'Restoring the table' : STAGES[stage]}{stage === 1
				? `: ${loads[0]} of ${loads[1]}`
				: ''}
		</p>
		<ol aria-hidden="true">
			{#each STAGES as name, i (name)}
				<li class:done={i < stage} class:now={i === stage}>{name}</li>
			{/each}
		</ol>
	</div>
{/if}

<style>
	/* No z-index: the room's panels, later in the page, stay usable above it. */
	.loading {
		position: absolute;
		inset: 0;
		display: grid;
		place-content: center;
		justify-items: center;
		gap: var(--sp-5);
		padding-inline: var(--free-left, 1rem) var(--free-right, 1rem);
		background: var(--bg);
		color: var(--muted);
	}

	svg {
		width: 3.5rem;
		fill: none;
		stroke: var(--accent);
		stroke-width: 1.4;
		stroke-linecap: round;
		stroke-linejoin: round;
		overflow: visible;
	}

	svg circle {
		fill: var(--accent);
		stroke: none;
	}

	g {
		transform-origin: 16px 4px;
		animation: sway 2.6s ease-in-out infinite alternate;
	}

	@keyframes sway {
		from {
			transform: rotate(-7deg);
		}
		to {
			transform: rotate(7deg);
		}
	}

	.stage {
		margin: 0;
		font-family: var(--font-display);
		font-size: var(--fs-xl);
		color: var(--text);
		font-variant-numeric: tabular-nums;
	}

	ol {
		display: flex;
		gap: var(--sp-6);
		margin: 0;
		padding: 0;
		list-style: none;
		font-size: var(--fs-xs);
		letter-spacing: 0.04em;
	}

	li {
		opacity: 0.4;
	}

	.done {
		opacity: 0.75;
	}

	.now {
		opacity: 1;
		color: var(--accent);
	}

	@media (prefers-reduced-motion: reduce) {
		g {
			animation: none;
		}
	}
</style>
