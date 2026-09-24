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
</script>

<section class="decision" aria-labelledby="decision-title">
	<p class="kicker" id="decision-title">A choice</p>
	<p class="prompt">{decision.prompt}</p>
	<div class="options">
		{#each decision.options as option (option.id)}
			<button
				type="button"
				disabled={!canAnswer}
				onclick={() =>
					send({ type: 'adventure_decide', decisionId: decision.id, optionId: option.id })}
			>
				{option.label}
			</button>
		{/each}
	</div>
	<p class="note">
		{canAnswer
			? 'Talk it over. The first answer stands.'
			: 'The party is deciding. Anyone playing a character can answer.'}
	</p>
</section>

<style>
	.decision {
		position: absolute;
		top: 1rem;
		left: 50%;
		transform: translateX(-50%);
		width: min(30rem, calc(100% - 2rem));
		display: grid;
		gap: 0.6rem;
		padding: 1rem 1.2rem;
		background: var(--panel-solid);
		border: 1px solid var(--accent);
		border-radius: 12px;
		box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
		z-index: 5;
	}

	.kicker {
		margin: 0;
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--accent);
	}

	.prompt {
		margin: 0;
	}

	.options {
		display: grid;
		gap: 0.4rem;
	}

	.options button {
		text-align: left;
	}

	.note {
		margin: 0;
		font-size: 0.8rem;
		color: var(--muted);
	}
</style>
