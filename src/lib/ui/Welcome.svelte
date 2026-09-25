<script lang="ts">
	import type { AdventureView } from '$lib/adventure/adventure';
	import Steps from './Steps.svelte';
	import { trapFocus } from './trap-focus';

	/**
	 * A new player's arrival: where they are (the server's words), what to do
	 * first, and whether to learn how to play or go straight in.
	 */
	interface Props {
		adventure: AdventureView;
		characterName: string;
		onLearn(): void;
		onSkip(): void;
	}

	let { adventure, characterName, onLearn, onSkip }: Props = $props();

	const goal = $derived(adventure.objectives.find((o) => !o.done && !o.optional));
</script>

<div class="backdrop">
	<div
		class="welcome vellum"
		role="dialog"
		aria-modal="true"
		aria-labelledby="welcome-title"
		tabindex="-1"
		use:trapFocus
		onkeydown={(e) => e.key === 'Escape' && onSkip()}
	>
		<Steps current={3} />
		<header>
			<h2 id="welcome-title">{adventure.welcome.title}</h2>
			<p class="subtitle">{adventure.title} · {characterName}</p>
		</header>
		<p class="text">{adventure.welcome.text}</p>
		{#if goal}
			<p class="goal"><span class="section-title">Your first goal</span>{goal.text}</p>
		{/if}
		<div class="actions">
			<!-- svelte-ignore a11y_autofocus -->
			<button type="button" class="primary" onclick={onLearn} autofocus>
				Show me how to play
			</button>
			<button type="button" onclick={onSkip}>I know how to play</button>
		</div>
	</div>
</div>

<style>
	.backdrop {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		padding: 5rem var(--sp-6) var(--sp-6);
		background: var(--scrim);
		overflow-y: auto;
		z-index: var(--z-panel);
	}

	.welcome {
		width: min(32rem, 100%);
		display: grid;
		gap: var(--sp-6);
		padding: var(--sp-7);
		border-radius: var(--radius-lg);
	}

	h2 {
		margin: 0;
		font-family: var(--font-display);
		font-size: var(--fs-xl);
	}

	.subtitle {
		margin: var(--sp-1) 0 0;
		color: var(--muted);
		font-size: var(--fs-sm);
	}

	.text {
		margin: 0;
		max-width: 65ch;
		font-family: var(--font-display);
		line-height: 1.5;
	}

	.goal {
		display: grid;
		gap: var(--sp-2);
		margin: 0;
		padding: var(--sp-4) var(--sp-5);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		background: var(--accent-wash);
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--sp-4);
	}
</style>
