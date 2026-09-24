<script lang="ts">
	import type { CharacterStatus } from '$lib/adventure/adventure';
	import {
		BLEED_OUT_ROUNDS,
		defenseFor,
		describeAction,
		STATS,
		STATUSES,
		type CharacterDef
	} from '$lib/adventure/characters';

	interface Props {
		character: CharacterDef;
		status: CharacterStatus | null;
		/** Shown as an introduction (just picked) rather than as a sheet looked up mid-game. */
		intro?: boolean;
		onClose(): void;
	}

	let { character, status, intro = false, onClose }: Props = $props();

	const roundsLeft = $derived(BLEED_OUT_ROUNDS - (status?.downedFor ?? 0));
	const guarded = $derived(!!status?.statuses.some((s) => s.id === 'guarded'));
</script>

<div
	class="backdrop"
	role="presentation"
	onclick={(e) => e.target === e.currentTarget && onClose()}
	onkeydown={(e) => e.key === 'Escape' && onClose()}
>
	<div
		class="sheet"
		style:--char={character.color}
		role="dialog"
		aria-modal="true"
		aria-labelledby="sheet-title"
	>
		<header>
			<p class="kicker">{intro ? 'You are playing' : 'Character'}</p>
			<h2 id="sheet-title">{character.name}</h2>
			<p class="tagline">{intro ? character.intro : character.tagline}</p>
		</header>

		<dl class="vitals">
			<div>
				<dt>HP</dt>
				<dd>{status ? `${status.hp}/${status.maxHp}` : character.hp}</dd>
			</div>
			<div>
				<dt>Armor</dt>
				<dd>{character.armor}{guarded ? ' +2' : ''}</dd>
			</div>
			<div>
				<dt>Defense</dt>
				<dd>{defenseFor(character.armor + (guarded ? 2 : 0))}</dd>
			</div>
			<div>
				<dt>Speed</dt>
				<dd>{character.speed}</dd>
			</div>
		</dl>

		<ul class="stats" aria-label="Stats">
			{#each STATS as stat (stat.id)}
				<li title={stat.about}>
					<span>{stat.name}</span>
					<b>{character.stats[stat.id] >= 0 ? '+' : ''}{character.stats[stat.id]}</b>
				</li>
			{/each}
		</ul>

		<h3>Actions</h3>
		<ul class="actions">
			{#each character.actions as action (action.id)}
				{@const left = status?.usesLeft[action.id]}
				<li>
					<div class="line">
						<strong>{action.name}</strong>
						{#if action.uses !== null}
							<span class="uses">{left ?? action.uses}/{action.uses} left</span>
						{/if}
					</div>
					<p class="summary">{describeAction(character, action)}</p>
					<p>{action.about}</p>
				</li>
			{/each}
		</ul>

		{#if status && (status.statuses.length || status.downed || status.dead)}
			<h3>Condition</h3>
			<ul class="conditions">
				{#if status.dead}
					<li><strong>Dead.</strong> Gone for the rest of this section.</li>
				{:else if status.downed}
					<li>
						<strong>Down.</strong> Can't move or act. Dies after {roundsLeft} more
						{roundsLeft === 1 ? 'round' : 'rounds'} unless healed.
					</li>
				{/if}
				{#each status.statuses as s (s.id)}
					<li><strong>{STATUSES[s.id].name}.</strong> {STATUSES[s.id].about}</li>
				{/each}
			</ul>
		{/if}

		<button class="primary" type="button" onclick={onClose}>
			{intro ? 'Into the story' : 'Close'}
		</button>
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

	.sheet {
		width: min(30rem, 100%);
		display: grid;
		gap: 0.75rem;
		padding: 1.25rem;
		background: var(--panel-solid);
		border: 1px solid var(--border);
		border-top: 4px solid var(--char);
		border-radius: 14px;
		box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
	}

	.kicker,
	.tagline {
		margin: 0;
		color: var(--muted);
	}

	.tagline {
		font-family: Georgia, 'Times New Roman', serif;
		line-height: 1.4;
	}

	h2 {
		margin: 0.15rem 0 0.35rem;
		font-size: 1.6rem;
		color: var(--char);
	}

	h3 {
		margin: 0;
		font-size: 0.8rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--muted);
	}

	.vitals {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 0.5rem;
		margin: 0;
	}

	.vitals div {
		padding: 0.4rem;
		text-align: center;
		border: 1px solid var(--border);
		border-radius: 8px;
	}

	dt {
		font-size: 0.75rem;
		color: var(--muted);
	}

	dd {
		margin: 0;
		font-size: 1.15rem;
		font-weight: 700;
	}

	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.5rem;
	}

	.stats {
		grid-template-columns: repeat(4, 1fr);
	}

	.stats li {
		display: grid;
		justify-items: center;
		font-size: 0.85rem;
		color: var(--muted);
	}

	.stats b {
		color: var(--accent);
		font-size: 1.05rem;
	}

	.actions li,
	.conditions li {
		padding: 0.5rem 0.6rem;
		border: 1px solid var(--border);
		border-radius: 8px;
	}

	.line {
		display: flex;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.uses {
		font-size: 0.8rem;
		color: var(--accent);
	}

	.actions p {
		margin: 0.2rem 0 0;
		font-size: 0.85rem;
		color: var(--muted);
	}

	.actions .summary {
		color: var(--text);
	}

	.conditions li {
		font-size: 0.9rem;
	}
</style>
