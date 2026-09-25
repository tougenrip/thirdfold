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
	<section class="end vellum" aria-labelledby="end-title">
		<h2 id="end-title">{won ? (adventure.ending?.headline ?? 'The end') : 'The lamps go out'}</h2>
		<p class="survival">{survivalLine(adventure.characters, won)}</p>
		<hr />
		<p class="subtitle">
			{adventure.title} · {won ? 'Adventure complete' : 'Adventure failed'}
		</p>

		{#if won && adventure.ending}
			<p class="lead">{adventure.ending.text}</p>
			{#if adventure.ending.scene}
				<p class="scene">
					<span class="section-title">The final scene</span>{adventure.ending.scene}
				</p>
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
			<ul class="tally num" aria-label="What the party did">
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
							class="star ghost"
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
					class="link ghost"
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
		padding: var(--sp-6);
		background: var(--scrim);
	}

	.end {
		width: min(32rem, 100%);
		max-height: calc(100% - 2rem);
		overflow-y: auto;
		display: grid;
		gap: var(--sp-5);
		padding: var(--sp-7);
		text-align: center;
		border-radius: var(--radius-lg);
	}

	.subtitle,
	.lead,
	.hint,
	.again {
		margin: 0;
		color: var(--muted);
	}

	.lead {
		max-width: 65ch;
		margin-inline: auto;
		font-family: var(--font-display);
		line-height: 1.5;
	}

	.subtitle {
		font-family: var(--font-display);
		font-variant: small-caps;
		letter-spacing: 0.04em;
	}

	.survival {
		margin: calc(-1 * var(--sp-2)) 0 0;
		font-family: var(--font-display);
		font-size: var(--fs-lg);
		font-style: italic;
	}

	hr {
		width: 40%;
		margin: var(--sp-2) auto;
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
		gap: var(--sp-2);
		margin: var(--sp-4) 0;
		color: var(--muted);
	}

	.rate > span:first-child {
		margin-right: var(--sp-3);
	}

	.stars {
		display: inline-flex;
		white-space: nowrap;
	}

	/* Bare glyphs, not keys: beat the vellum's button look. */
	.end .star,
	.end .star:hover {
		padding: var(--sp-1) var(--sp-3);
		font-size: var(--fs-lg);
		line-height: 1;
		border: none;
		background: none;
		color: var(--muted);
	}

	.end .star.lit {
		color: var(--accent);
	}

	.tally {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: var(--sp-3) var(--sp-6);
		font-size: var(--fs-sm);
		color: var(--muted);
	}

	.tally strong {
		color: var(--text);
	}

	.again {
		color: var(--accent);
	}

	.hint {
		font-size: var(--fs-xs);
	}

	.end .link,
	.end .link:hover {
		padding: 0;
		border: 0;
		background: none;
		color: var(--muted);
		text-decoration: underline;
		font-size: inherit;
	}

	.scene {
		margin: 0;
		padding: var(--sp-4) var(--sp-5);
		display: grid;
		gap: var(--sp-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		background: var(--accent-wash);
		text-align: left;
		font-family: var(--font-display);
		font-size: var(--fs-sm);
	}

	h2 {
		margin: 0;
		font-family: var(--font-display);
		font-size: var(--fs-2xl);
		line-height: 1.1;
	}

	dl {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: var(--sp-3) var(--sp-6);
		margin: var(--sp-2) 0;
		padding: var(--sp-5) 0;
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
		margin-left: var(--sp-3);
	}

	.row {
		display: flex;
		gap: var(--sp-4);
		justify-content: center;
		flex-wrap: wrap;
		align-items: center;
	}
</style>
