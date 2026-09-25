<script lang="ts">
	import type { DecisionView } from '$lib/adventure/adventure';
	import type { RoomAction } from '$lib/net/room-connection.svelte';

	interface Props {
		decision: DecisionView;
		/** Whether this viewer may answer: the GM, or a player whose character is standing. */
		canAnswer: boolean;
		send(action: RoomAction): boolean;
	}

	let { decision, canAnswer, send }: Props = $props();

	/** The answer picked but not yet given: the first answer stands, so it takes a second step. */
	let picked = $state<string | null>(null);
	const pickedOption = $derived(decision.options.find((o) => o.id === picked) ?? null);

	function answer() {
		if (!pickedOption) return;
		send({ type: 'adventure_decide', decisionId: decision.id, optionId: pickedOption.id });
		picked = null;
	}
</script>

<section class="decision vellum" aria-labelledby="decision-title">
	<h2 id="decision-title">A choice</h2>
	<!-- Announced as it appears: a choice everyone at the table should hear about. -->
	<p class="prompt" role="alert">{decision.prompt}</p>
	{#if pickedOption}
		<div class="confirm">
			<p class="picked">{pickedOption.label}</p>
			<p class="note">This is final for the whole party. Is everyone agreed?</p>
			<div class="actions">
				<button type="button" class="primary" onclick={answer}>Choose this</button>
				<button type="button" class="ghost" onclick={() => (picked = null)}>Go back</button>
			</div>
		</div>
	{:else}
		<div class="options">
			{#each decision.options as option (option.id)}
				<button type="button" disabled={!canAnswer} onclick={() => (picked = option.id)}>
					{option.label}
				</button>
			{/each}
		</div>
		<p class="note">
			{canAnswer
				? 'Talk it over. The first answer stands.'
				: 'The party is deciding. Anyone playing a character can answer.'}
		</p>
	{/if}
</section>

<style>
	.decision {
		position: absolute;
		/* Centred in the table's free space, below the header (RoomView sets these). */
		top: var(--below-bar, 1rem);
		left: calc((100% - var(--free-right, 0px)) / 2);
		transform: translateX(-50%);
		width: min(30rem, calc(100% - var(--free-right, 0px) - 2rem));
		display: grid;
		gap: var(--sp-4);
		padding: var(--sp-6) var(--sp-6);
		border-radius: var(--radius-lg);
		z-index: var(--z-overlay);
	}

	h2 {
		margin: 0;
		font-family: var(--font-display);
		font-size: var(--fs-xl);
	}

	.prompt {
		margin: 0;
		max-width: 65ch;
	}

	.options {
		display: grid;
		gap: var(--sp-3);
	}

	.options button {
		text-align: left;
	}

	.confirm {
		display: grid;
		gap: var(--sp-4);
	}

	.picked {
		margin: 0;
		padding: var(--sp-4) var(--sp-5);
		font-family: var(--font-display);
		font-size: var(--fs-lg);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-md);
	}

	.actions {
		display: flex;
		gap: var(--sp-4);
	}

	.note {
		margin: 0;
		font-size: var(--fs-xs);
		color: var(--muted);
	}
</style>
