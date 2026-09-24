<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import type { AdventureView } from '$lib/adventure/adventure';
	import { CHARACTERS } from '$lib/adventure/characters';
	import type { PublicPlayer } from '$lib/game/protocol';
	import type { RoomAction } from '$lib/net/room-connection.svelte';
	import { namesList, survivalLine, timePlayed } from './session-end';

	interface Props {
		adventure: AdventureView;
		players: readonly PublicPlayer[];
		/** The viewer's player id. */
		me: string;
		isGm: boolean;
		send(action: RoomAction): boolean;
		/** Close the screen and go on looking around the table. */
		onClose(): void;
	}

	let { adventure, players, me, isGm, send, onClose }: Props = $props();

	const won = $derived(adventure.stage === 'complete');
	const party = $derived(adventure.characters.filter((c) => c.inPlay));
	const nameOf = (id: string | null) => (id && players.find((p) => p.id === id)?.name) || 'GM';
	const played = $derived(timePlayed(adventure.begunAt, adventure.completedAt));
	const summary = $derived(adventure.summary);
	const asked = $derived(summary?.again.includes(me) ?? false);
	const askers = $derived(
		(summary?.again ?? []).flatMap((id) => players.find((p) => p.id === id)?.name ?? [])
	);
	const isPlayer = $derived(players.find((p) => p.id === me)?.role === 'player');
</script>

<div class="backdrop">
	<section class="end" aria-labelledby="end-title">
		<h2 id="end-title">{won ? (adventure.ending?.headline ?? 'The end') : 'The lamps go out'}</h2>
		<p class="survival">{survivalLine(adventure.characters, won)}</p>
		<hr />
		<p class="kicker">
			{adventure.title} · {won ? 'Adventure complete' : 'Adventure failed'}
		</p>

		{#if won && adventure.ending}
			<p class="lead">{adventure.ending.text}</p>
			{#if adventure.ending.scene}
				<p class="scene"><span>The final scene</span>{adventure.ending.scene}</p>
			{/if}
		{:else if !won}
			<p class="lead">The dark has won this night. The story can begin again.</p>
		{/if}

		<dl>
			{#if party.length}
				<dt>Players</dt>
				<dd>
					<ul>
						{#each party as c (c.id)}
							<li class:dead={c.dead}>
								{CHARACTERS[c.id].name}
								<small>{nameOf(c.playerId)}{c.dead ? ' · fell' : ''}</small>
							</li>
						{/each}
					</ul>
				</dd>
			{/if}
			{#if played}
				<dt>Time played</dt>
				<dd class="time">{played}</dd>
			{/if}
			<dt>{won ? 'Ending' : 'Fell in'}</dt>
			<dd>
				{#if won && adventure.ending}
					<strong>{adventure.ending.title}</strong>
					<small>{adventure.ending.subtitle}</small>
				{:else}
					Chapter {adventure.chapter.number}: {adventure.chapter.title}
				{/if}
			</dd>
			{#if won}
				{#each adventure.ending?.result ?? [] as r (r.label)}
					<dt>{r.label}</dt>
					<dd>{r.value}</dd>
				{/each}
			{/if}
			{#each adventure.decisions as d (d.id)}
				<dt>{d.prompt}</dt>
				<dd>{d.choice} <small>{d.by}</small></dd>
			{/each}
			{#if adventure.rewards.length}
				<dt>Earned</dt>
				<dd>{adventure.rewards.join(', ')}</dd>
			{/if}
		</dl>

		{#if summary}
			<ul class="tally" aria-label="What the party did">
				<li><strong>{summary.chapters}</strong> chapters</li>
				<li><strong>{summary.fightsWon}</strong> fights won</li>
				<li><strong>{summary.foesDefeated}</strong> foes defeated</li>
				<li><strong>{summary.evidence}</strong> evidence found</li>
			</ul>
		{/if}

		{#if adventure.library?.canRate}
			<div class="rate" role="group" aria-label="Rate this adventure">
				<span
					>{adventure.library.rated
						? `You gave it ${adventure.library.rated} of 5. Change it?`
						: `How was it? Rate ${adventure.library.creator.name}’s adventure:`}</span
				>
				<span class="stars">
					{#each [1, 2, 3, 4, 5] as stars (stars)}
						<button
							type="button"
							class="star"
							class:lit={(adventure.library.rated ?? 0) >= stars}
							aria-label={`${stars} of 5`}
							aria-pressed={adventure.library.rated === stars}
							onclick={() => send({ type: 'adventure_rate', stars })}>★</button
						>
					{/each}
				</span>
			</div>
		{/if}

		{#if askers.length}
			<p class="again">{namesList(askers)} would like to play again.</p>
		{/if}

		<div class="row">
			<button class={isGm ? '' : 'primary'} type="button" onclick={onClose}>
				Return to table
			</button>
			{#if isGm}
				<button
					class="primary"
					type="button"
					onclick={() => send({ type: 'adventure_control', op: 'restart' })}
				>
					Replay
				</button>
			{:else if isPlayer}
				<button type="button" disabled={asked} onclick={() => send({ type: 'adventure_again' })}>
					{asked ? 'Asked to replay' : 'Replay'}
				</button>
			{/if}
			<button type="button" onclick={() => goto(resolve('/'))}>Return to lobby</button>
		</div>
		<p class="hint">
			{#if isGm}
				Replay starts the story over from the beginning with the same party.
				<button
					class="link"
					type="button"
					onclick={() => send({ type: 'adventure_control', op: 'end' })}
				>
					Or end it and keep a free table.
				</button>
			{:else if isPlayer}
				Return to the table to keep exploring; replaying asks the GM to start it over.
			{:else}
				Return to the table to keep watching.
			{/if}
		</p>
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
		width: min(32rem, 100%);
		max-height: calc(100% - 2rem);
		overflow-y: auto;
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
	.hint,
	.again {
		margin: 0;
		color: var(--muted);
	}

	.kicker {
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.12em;
	}

	.survival {
		margin: -0.25rem 0 0;
		font-size: 1.1rem;
		font-style: italic;
	}

	hr {
		width: 40%;
		margin: 0.25rem auto;
		border: 0;
		border-top: 1px solid var(--border);
	}

	.time {
		font-variant-numeric: tabular-nums;
	}

	li.dead {
		opacity: 0.6;
	}

	.rate {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.2rem;
		margin: 0.6rem 0;
		color: var(--muted);
	}

	.rate > span:first-child {
		margin-right: 0.4rem;
	}

	.stars {
		display: inline-flex;
		white-space: nowrap;
	}

	.star {
		padding: 0.1rem 0.35rem;
		font-size: 1.3rem;
		line-height: 1;
		border: none;
		background: none;
		color: var(--muted);
	}

	.star.lit {
		color: var(--accent);
	}

	.tally {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 0.4rem 1rem;
		font-size: 0.85rem;
		color: var(--muted);
	}

	.tally strong {
		color: var(--text);
	}

	.again {
		color: var(--accent);
	}

	.hint {
		font-size: 0.8rem;
	}

	.link {
		padding: 0;
		border: 0;
		background: none;
		color: var(--muted);
		text-decoration: underline;
		font-size: inherit;
		cursor: pointer;
	}

	.scene {
		margin: 0;
		padding: 0.6rem 0.8rem;
		display: grid;
		gap: 0.2rem;
		border-left: 3px solid var(--accent);
		background: rgba(255, 255, 255, 0.03);
		text-align: left;
		font-size: 0.92rem;
	}

	.scene span {
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
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
