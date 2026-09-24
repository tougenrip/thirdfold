<script lang="ts">
	import type { AdventureView } from '$lib/adventure/adventure';
	import Steps from './Steps.svelte';

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
	<div class="welcome" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
		<Steps current={3} />
		<header>
			<p class="kicker">{adventure.title} · {characterName}</p>
			<h2 id="welcome-title">{adventure.welcome.title}</h2>
		</header>
		<p class="text">{adventure.welcome.text}</p>
		{#if goal}
			<p class="goal"><span>Your first goal</span>{goal.text}</p>
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
		padding: 5rem 1rem 1rem;
		background: rgba(10, 8, 6, 0.55);
		overflow-y: auto;
		z-index: 3;
	}

	.welcome {
		width: min(32rem, 100%);
		display: grid;
		gap: 0.9rem;
		padding: 1.4rem;
		background: var(--panel-solid);
		border: 1px solid var(--border);
		border-top: 4px solid var(--accent);
		border-radius: 14px;
		box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
	}

	.kicker {
		margin: 0;
		color: var(--muted);
		font-size: 0.85rem;
	}

	h2 {
		margin: 0.15rem 0 0;
		font-size: 1.7rem;
		color: var(--accent);
	}

	.text {
		margin: 0;
		font-family: Georgia, 'Times New Roman', serif;
		line-height: 1.5;
	}

	.goal {
		display: grid;
		gap: 0.2rem;
		margin: 0;
		padding: 0.6rem 0.8rem;
		border-left: 3px solid var(--accent);
		background: rgba(224, 164, 88, 0.08);
	}

	.goal span {
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--muted);
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
</style>
