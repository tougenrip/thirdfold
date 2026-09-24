<script lang="ts">
	import type { AdventureView } from '$lib/adventure/adventure';
	import { CHARACTER_IDS, CHARACTERS, defenseFor, describeAction } from '$lib/adventure/characters';
	import type { PublicPlayer } from '$lib/game/protocol';
	import type { RoomAction } from '$lib/net/room-connection.svelte';
	import Steps from './Steps.svelte';

	interface Props {
		adventure: AdventureView;
		players: readonly PublicPlayer[];
		send(action: RoomAction): boolean;
	}

	let { adventure, players, send }: Props = $props();

	const status = (id: (typeof CHARACTER_IDS)[number]) =>
		adventure.characters.find((c) => c.id === id);
	const baseDefense = defenseFor(0);
	const takenBy = (id: (typeof CHARACTER_IDS)[number]) => {
		const s = status(id);
		if (!s?.inPlay) return null;
		return (s.playerId && players.find((p) => p.id === s.playerId)?.name) || 'the GM';
	};
</script>

<div class="backdrop">
	<section class="select" aria-labelledby="choose-title">
		<header>
			<Steps current={2} />
			<p class="kicker">{adventure.title} · {adventure.location.name}</p>
			<h2 id="choose-title">Choose your character</h2>
			<p class="help">
				Pick whoever sounds like you. Each has two actions; you can change your mind until the story
				begins.
			</p>
		</header>
		<ul>
			{#each CHARACTER_IDS as id (id)}
				{@const c = CHARACTERS[id]}
				{@const taken = takenBy(id)}
				<li>
					<button
						type="button"
						class="card"
						style:--char={c.color}
						disabled={!!taken}
						onclick={() => send({ type: 'adventure_claim', characterId: id })}
					>
						<span class="name">{c.name}</span>
						<span class="tagline">{c.tagline}</span>
						<span class="stats">
							<span><b>{c.hp}</b> HP</span>
							<span><b>{c.armor}</b> Armor</span>
							<span><b>{c.speed}</b> Speed</span>
						</span>
						{#each c.actions as action (action.id)}
							<span class="attack"><b>{action.name}</b>: {describeAction(c, action)}</span>
						{/each}
						<span class="pick">{taken ? `Taken by ${taken}` : `Play ${c.name}`}</span>
					</button>
				</li>
			{/each}
		</ul>
		<p class="note">
			To hit, roll a d20 plus the attack's bonus and reach {baseDefense} + the target's armor. Limited
			abilities come back at the start of each fight.
		</p>
	</section>
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
	}

	.select {
		width: min(52rem, 100%);
		display: grid;
		gap: 1rem;
		padding: 1.25rem;
		background: var(--panel-solid);
		border: 1px solid var(--border);
		border-radius: 14px;
		box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
	}

	.kicker {
		margin: 0.8rem 0 0;
		color: var(--muted);
		font-size: 0.85rem;
	}

	.help {
		margin: 0;
		color: var(--muted);
		font-size: 0.9rem;
	}

	h2 {
		margin: 0.2rem 0 0;
		font-size: 1.5rem;
	}

	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
		gap: 0.75rem;
	}

	.card {
		width: 100%;
		height: 100%;
		display: grid;
		align-content: start;
		gap: 0.5rem;
		padding: 0.9rem;
		text-align: left;
		border: 1px solid var(--border);
		border-top: 4px solid var(--char);
		border-radius: 10px;
	}

	.card:not(:disabled):hover {
		border-color: var(--char);
	}

	.name {
		font-size: 1.1rem;
		font-weight: 700;
	}

	.tagline,
	.attack {
		font-size: 0.85rem;
		color: var(--muted);
	}

	.stats {
		display: flex;
		gap: 0.75rem;
		font-size: 0.85rem;
	}

	.stats b {
		color: var(--accent);
	}

	.pick {
		margin-top: 0.25rem;
		font-weight: 600;
		color: var(--char);
	}

	.card:disabled .pick {
		color: var(--muted);
	}

	.note {
		margin: 0;
		font-size: 0.8rem;
		color: var(--muted);
	}
</style>
