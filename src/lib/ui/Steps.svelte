<script lang="ts">
	import { FIRST_SESSION } from './tutorial';

	/** Where a new player is in the first session (an index into FIRST_SESSION). */
	let { current }: { current: number } = $props();
</script>

<ol class="steps" aria-label="Getting started">
	{#each FIRST_SESSION as label, i (label)}
		<li
			class:done={i < current}
			class:now={i === current}
			aria-current={i === current ? 'step' : undefined}
		>
			<span class="dot num">{i < current ? '✓' : i + 1}</span>
			<span class="label">{label}</span>
		</li>
	{/each}
</ol>

<style>
	.steps {
		display: flex;
		flex-wrap: wrap;
		gap: var(--sp-3) var(--sp-5);
		margin: 0;
		padding: 0;
		list-style: none;
		font-size: var(--fs-xs);
		color: var(--muted);
	}

	li {
		display: flex;
		align-items: center;
		gap: var(--sp-3);
	}

	.dot {
		display: grid;
		place-items: center;
		width: 1.2rem;
		height: 1.2rem;
		border: 1px solid var(--border);
		border-radius: 50%;
		font-size: var(--fs-2xs);
	}

	.done .dot {
		border-color: var(--accent);
		color: var(--accent);
	}

	.now {
		color: var(--text);
		font-weight: 700;
	}

	.now .dot {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--accent-text);
	}
</style>
