<script lang="ts">
	import type { AdventureView } from '$lib/adventure/adventure';
	import { defenseFor } from '$lib/adventure/characters';
	import type { PublicPlayer } from '$lib/game/protocol';
	import type { CreatorReply, RoomAction } from '$lib/net/room-connection.svelte';
	import { loadDraft } from './dnd/creator-draft';
	import Steps from './Steps.svelte';

	interface Props {
		adventure: AdventureView;
		players: readonly PublicPlayer[];
		send(action: RoomAction): boolean;
		/** For a story whose players may build their own characters. */
		roomId?: string;
		creatorReply?: CreatorReply | null;
		/** This player's name: a campaign's characters are kept for their players. */
		myName?: string;
	}

	let { adventure, players, send, roomId = '', creatorReply = null, myName = '' }: Props = $props();

	/** A character the campaign brought, and the player it is kept for. */
	const memberOf = (id: string) => adventure.campaign?.members.find((m) => m.id === id) ?? null;
	const keptFor = (id: string) => {
		const player = memberOf(id)?.player;
		return player && player.toLowerCase() !== myName.toLowerCase() ? player : null;
	};

	/** The rules' character creator, where the story lets players build their own. */
	const canCreate = $derived(adventure.build?.rules === 'dnd-5.5e' && !!roomId);
	// A creation left half-way opens where it was.
	let creating = $state(false);
	$effect.pre(() => {
		if (canCreate && roomId && loadDraft(roomId)) creating = true;
	});

	const status = (id: string) => adventure.characters.find((c) => c.id === id);
	const baseDefense = defenseFor(0);
	const classic = $derived(adventure.rules.id === 'thirdfold-classic');
	/** In the story with nobody playing it (a continued game): a player can take it up. */
	const unclaimed = (id: string) => {
		const s = status(id);
		return !!s?.inPlay && !s.playerId && adventure.stage !== 'choosing';
	};
	const takenBy = (id: string) => {
		const s = status(id);
		if (!s?.inPlay || unclaimed(id)) return null;
		return (s.playerId && players.find((p) => p.id === s.playerId)?.name) || 'the GM';
	};
</script>

{#if creating && canCreate}
	<!-- Loaded only when a player opens it: most tables never do. -->
	{#await import('./dnd/CharacterCreator.svelte') then { default: CharacterCreator }}
		<CharacterCreator {roomId} reply={creatorReply} {send} onClose={() => (creating = false)} />
	{/await}
{:else}
	<div class="backdrop">
		<section class="select" aria-labelledby="choose-title">
			<header>
				<Steps current={2} />
				<h2 id="choose-title">Choose your character</h2>
				<p class="subtitle">{adventure.title} · {adventure.location.name}</p>
				<p class="help">
					Pick whoever sounds like you. Each has two actions; you can change your mind until the
					story begins.
				</p>
			</header>
			<ul>
				{#each adventure.characters as character (character.id)}
					{@const id = character.id}
					{@const c = character.def}
					{@const taken = takenBy(id)}
					{@const member = memberOf(id)}
					{@const kept = keptFor(id)}
					<li>
						<button
							type="button"
							class="card"
							style:--char={c.color}
							disabled={!!taken || !!kept}
							onclick={() => send({ type: 'adventure_claim', characterId: id })}
						>
							<span class="name"><span class="seal" aria-hidden="true"></span>{c.name}</span>
							{#if character.card.title}<span class="title">{character.card.title}</span>{/if}
							{#if member}<span class="campaign"
									>From {adventure.campaign!.name}{member.player
										? ` · ${member.player}’s`
										: ''}</span
								>{/if}
							<span class="tagline">{c.tagline}</span>
							<span class="stats num">
								<span><b>{c.hp}</b> HP</span>
								<span><b>{character.card.defense.value}</b> {character.card.defense.name}</span>
								{#if character.card.level !== null}<span>Level <b>{character.card.level}</b></span
									>{/if}
								<span><b>{c.speed}</b> Speed</span>
							</span>
							{#each character.card.actions as action, i (action.id)}
								<span class="attack"
									><b>{c.actions[i]?.name ?? action.id}</b>{action.part === 'action'
										? ''
										: ` (${action.partName.toLowerCase()})`}: {action.summary}</span
								>
							{/each}
							<span class="pick"
								>{taken
									? `Taken by ${taken}`
									: kept
										? `Kept for ${kept}`
										: unclaimed(id)
											? `Take up ${c.name} again`
											: `Play ${c.name}`}</span
							>
						</button>
					</li>
				{/each}
			</ul>
			<p class="note">
				{#if classic}
					To hit, roll a d20 plus the attack's bonus and reach {baseDefense} + the target's armor. Limited
					abilities come back at the start of each fight.
				{:else}
					This story plays by {adventure.rules.name}. The table works out every roll for you;
					limited abilities come back at the start of each fight.
				{/if}
			</p>
			{#if canCreate}
				<div class="create">
					<p>
						Or make your own: pick a species, background and class, and the table works out the
						rest.
					</p>
					<button type="button" class="primary" onclick={() => (creating = true)}
						>Create your own character</button
					>
				</div>
			{/if}
			{#if adventure.rules.attribution}
				<p class="note attribution">{adventure.rules.attribution}</p>
			{/if}
		</section>
	</div>
{/if}

<style>
	.backdrop {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		padding: 5rem var(--sp-6) var(--sp-6);
		background: var(--scrim);
		overflow-y: auto;
	}

	.select {
		width: min(52rem, 100%);
		display: grid;
		gap: var(--sp-6);
		padding: var(--sp-7);
		background: var(--panel-solid);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-lg);
	}

	.subtitle {
		margin: var(--sp-1) 0 var(--sp-3);
		color: var(--muted);
		font-size: var(--fs-sm);
	}

	.help {
		margin: 0;
		max-width: 65ch;
		color: var(--muted);
		font-size: var(--fs-sm);
	}

	h2 {
		margin: var(--sp-5) 0 0;
		font-size: var(--fs-xl);
	}

	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
		gap: var(--sp-5);
	}

	.card {
		width: 100%;
		height: 100%;
		display: grid;
		align-content: start;
		gap: var(--sp-4);
		padding: var(--sp-6);
		text-align: left;
	}

	.card:not(:disabled):hover {
		border-color: var(--char);
	}

	.name {
		display: flex;
		align-items: center;
		gap: var(--sp-4);
		font-family: var(--font-display);
		font-size: var(--fs-lg);
		font-weight: 700;
	}

	.seal {
		flex: none;
		width: 0.7rem;
		height: 0.7rem;
		border-radius: 50%;
		background: var(--char);
		border: 1px solid var(--border-strong);
	}

	.card:disabled .seal {
		opacity: 0.5;
	}

	.campaign {
		font-size: var(--fs-xs);
		color: var(--accent);
	}

	.tagline,
	.attack {
		font-size: var(--fs-sm);
		color: var(--muted);
	}

	.title {
		font-size: var(--fs-sm);
		font-weight: 600;
	}

	.create {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--sp-4);
		padding: var(--sp-4);
		border: 1px dashed var(--border);
		border-radius: var(--radius-md);
	}

	.create p {
		margin: 0;
		color: var(--muted);
		font-size: var(--fs-sm);
	}

	.stats {
		display: flex;
		gap: var(--sp-5);
		font-size: var(--fs-sm);
	}

	.stats b {
		color: var(--accent);
	}

	.pick {
		margin-top: var(--sp-2);
		font-weight: 700;
		color: var(--char);
	}

	.card:disabled .pick {
		color: var(--muted);
	}

	.note {
		margin: 0;
		font-size: var(--fs-xs);
		color: var(--muted);
	}

	.attribution {
		font-size: var(--fs-2xs);
		opacity: 0.8;
	}
</style>
