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
			<span class="dot">{i < current ? '✓' : i + 1}</span>
			<span class="label">{label}</span>
		</li>
	{/each}
</ol>

<style>
	.steps {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem 0.8rem;
		margin: 0;
		padding: 0;
		list-style: none;
		font-size: 0.75rem;
		color: var(--muted);
	}

	li {
		display: flex;
		align-items: center;
		gap: 0.3rem;
	}

	.dot {
		display: grid;
		place-items: center;
		width: 1.2rem;
		height: 1.2rem;
		border: 1px solid var(--border);
		border-radius: 50%;
		font-size: 0.65rem;
	}

	.done .dot {
		border-color: var(--accent);
		color: var(--accent);
	}

	.now {
		color: var(--text);
		font-weight: 600;
	}

	.now .dot {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--accent-text);
	}
</style>
