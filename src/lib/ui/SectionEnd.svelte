<script lang="ts">
	import type { AdventureView } from '$lib/adventure/adventure';
	import { CHARACTERS } from '$lib/adventure/characters';
	import type { PublicPlayer } from '$lib/game/protocol';
	import type { RoomAction } from '$lib/net/room-connection.svelte';

	interface Props {
		adventure: AdventureView;
		players: readonly PublicPlayer[];
		isGm: boolean;
		send(action: RoomAction): boolean;
		onClose(): void;
	}

	let { adventure, players, isGm, send, onClose }: Props = $props();

	const won = $derived(adventure.stage === 'complete');
	const party = $derived(adventure.characters.filter((c) => c.inPlay));
	const nameOf = (id: string | null) => (id && players.find((p) => p.id === id)?.name) || 'GM';

	function played(): string | null {
		if (!adventure.begunAt || !adventure.completedAt) return null;
		const s = Math.max(0, Math.round((adventure.completedAt - adventure.begunAt) / 1000));
		const two = (n: number) => String(n).padStart(2, '0');
		return `${two(Math.floor(s / 3600))}:${two(Math.floor((s % 3600) / 60))}:${two(s % 60)}`;
	}
</script>

<div class="backdrop">
	<section class="end" aria-labelledby="end-title">
		<p class="kicker">{adventure.title} · {adventure.section}</p>
		<h2 id="end-title">{won ? 'The bell is silent' : 'The lamps go out'}</h2>
		<p class="lead">
			{won
				? 'The party leaves Bellweather behind and climbs toward the monastery.'
				: 'The Hound has won this night. The story can begin again.'}
		</p>

		<dl>
			<dt>{won ? 'Section complete' : 'Section'}</dt>
			<dd>{adventure.section}</dd>
			{#if party.length}
				<dt>Party</dt>
				<dd>
					<ul>
						{#each party as c (c.id)}
							<li>
								{CHARACTERS[c.id].name}
								<small>{nameOf(c.playerId)}</small>
							</li>
						{/each}
					</ul>
				</dd>
			{/if}
			{#if won && played()}
				<dt>Time played</dt>
				<dd>{played()}</dd>
			{/if}
			<dt>Clues found</dt>
			<dd>{adventure.clues.length}</dd>
		</dl>

		{#if won}
			<p class="next">Part Two, The Monastery, is still being written.</p>
		{/if}

		<div class="row">
			{#if isGm}
				<button
					class="primary"
					type="button"
					onclick={() => send({ type: 'adventure_control', op: 'restart' })}
				>
					{won ? 'Play the section again' : 'Try again'}
				</button>
				<button type="button" onclick={() => send({ type: 'adventure_control', op: 'end' })}>
					Back to a free table
				</button>
			{:else}
				<p class="wait">The GM decides what happens next.</p>
			{/if}
			<button type="button" onclick={onClose}>Look around</button>
		</div>
	</section>
</div>

<style>
	.backdrop {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		padding: 1rem;
		background: rgba(8, 6, 4, 0.6);
	}

	.end {
		width: min(30rem, 100%);
		display: grid;
		gap: 0.75rem;
		padding: 1.5rem;
		text-align: center;
		background: var(--panel-solid);
		border: 1px solid var(--accent);
		border-radius: 14px;
		box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6);
	}

	.kicker,
	.lead,
	.next,
	.wait {
		margin: 0;
		color: var(--muted);
	}

	h2 {
		margin: 0;
		font-size: 1.8rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--accent);
	}

	dl {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 0.35rem 1rem;
		margin: 0.25rem 0;
		padding: 0.75rem 0;
		border-block: 1px solid var(--border);
		text-align: left;
	}

	dt {
		color: var(--muted);
	}

	dd {
		margin: 0;
	}

	ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	small {
		color: var(--muted);
		margin-left: 0.3rem;
	}

	.row {
		display: flex;
		gap: 0.5rem;
		justify-content: center;
		flex-wrap: wrap;
		align-items: center;
	}
</style>
