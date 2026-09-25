<script lang="ts">
	import type { CharacterCard, CharacterStatus, SheetValue } from '$lib/adventure/adventure';
	import { BLEED_OUT_ROUNDS, STATUSES, type CharacterDef } from '$lib/adventure/characters';
	import { trapFocus } from './trap-focus';

	interface Props {
		character: CharacterDef;
		/** Its numbers as the story's rules work them out (from the server). */
		card: CharacterCard;
		status: CharacterStatus | null;
		/** Shown as an introduction (just picked) rather than as a sheet looked up mid-game. */
		intro?: boolean;
		onClose(): void;
	}

	let { character, card, status, intro = false, onClose }: Props = $props();

	const roundsLeft = $derived(BLEED_OUT_ROUNDS - (status?.downedFor ?? 0));
	const signed = (n: number) => `${n >= 0 ? '+' : ''}${n}`;
	const partOf = (id: string) => card.actions.find((a) => a.id === id);
	const proficient = (list: SheetValue[]) => list.filter((v) => v.proficient);
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
		use:trapFocus
	>
		<header>
			<h2 id="sheet-title">
				<span class="seal" aria-hidden="true"></span>
				{#if intro}<span class="lead">You are playing</span>{/if}
				{character.name}
			</h2>
			<p class="tagline">{intro ? character.intro : character.tagline}</p>
		</header>

		<dl class="vitals num">
			<div>
				<dt>HP</dt>
				<dd>{status ? `${status.hp}/${status.maxHp}` : character.hp}</dd>
			</div>
			<div>
				<dt>{card.defense.name}</dt>
				<dd>{card.defense.value}</dd>
			</div>
			<div>
				<dt>Speed</dt>
				<dd>{character.speed}</dd>
			</div>
			{#if card.level !== null}
				<div>
					<dt>Level</dt>
					<dd>{card.level}</dd>
				</div>
			{/if}
			{#if card.proficiency !== null}
				<div>
					<dt>Proficiency</dt>
					<dd>{signed(card.proficiency)}</dd>
				</div>
			{/if}
		</dl>

		<ul class="stats num" aria-label="Stats">
			{#each card.stats as stat (stat.id)}
				<li>
					<span>{stat.name}</span>
					<b>{signed(stat.bonus)}</b>
					{#if stat.score !== null}<small>{stat.score}</small>{/if}
				</li>
			{/each}
		</ul>

		{#if card.saves.length}
			<p class="proficiencies">
				<span class="section-title">Saving throws</span>
				{#each card.saves as save, i (save.id)}{i ? ' · ' : ''}<span
						class:proficient={save.proficient}
						>{save.name}
						<b class="num">{signed(save.bonus)}</b></span
					>{/each}
			</p>
		{/if}
		{#if card.skills.length}
			<p class="proficiencies">
				<span class="section-title">Skills</span>
				{#each proficient(card.skills) as skill, i (skill.id)}{i ? ' · ' : ''}<span
						class="proficient">{skill.name} <b class="num">{signed(skill.bonus)}</b></span
					>{:else}None{/each}
			</p>
		{/if}

		<h3 class="section-title">Actions</h3>
		<ul class="actions">
			{#each character.actions as action (action.id)}
				{@const left = status?.usesLeft[action.id]}
				<li>
					<div class="line">
						<strong>{action.name}</strong>
						{#if partOf(action.id) && partOf(action.id)?.part !== 'action'}
							<span class="uses">{partOf(action.id)?.partName}</span>
						{/if}
						{#if action.uses !== null}
							<span class="uses num">{left ?? action.uses}/{action.uses} left</span>
						{/if}
					</div>
					<p class="summary">{partOf(action.id)?.summary ?? ''}</p>
					<p>{action.about}</p>
				</li>
			{/each}
		</ul>

		{#if status && (status.statuses.length || status.downed || status.dead)}
			<h3 class="section-title">Condition</h3>
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
		padding: 5rem var(--sp-6) var(--sp-6);
		background: var(--scrim);
		overflow-y: auto;
		z-index: var(--z-panel);
	}

	.sheet {
		width: min(30rem, 100%);
		display: grid;
		gap: var(--sp-5);
		padding: var(--sp-7);
		background: var(--panel-solid);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-lg);
	}

	.tagline {
		margin: 0;
		max-width: 65ch;
		color: var(--muted);
		font-family: var(--font-display);
		line-height: 1.4;
	}

	h2 {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--sp-4);
		margin: 0 0 var(--sp-3);
		font-size: var(--fs-xl);
	}

	.seal {
		flex: none;
		width: 0.7rem;
		height: 0.7rem;
		border-radius: 50%;
		background: var(--char);
		border: 1px solid var(--border-strong);
	}

	.lead {
		font-size: var(--fs-md);
		font-weight: 400;
		color: var(--muted);
	}

	.vitals {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: var(--sp-4);
		margin: 0;
	}

	.vitals div {
		padding: var(--sp-3);
		text-align: center;
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
	}

	dt {
		font-size: var(--fs-xs);
		color: var(--muted);
	}

	dd {
		margin: 0;
		font-size: var(--fs-lg);
		font-weight: 700;
	}

	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: var(--sp-4);
	}

	.proficiencies {
		margin: 0;
		font-size: var(--fs-sm);
		color: var(--muted);
	}

	.proficiencies .section-title {
		display: block;
	}

	.proficiencies .proficient {
		color: var(--text);
	}

	.stats small {
		display: block;
		font-size: var(--fs-2xs);
		opacity: 0.7;
	}

	.stats {
		grid-template-columns: repeat(4, 1fr);
	}

	.stats li {
		display: grid;
		justify-items: center;
		font-size: var(--fs-sm);
		color: var(--muted);
	}

	.stats b {
		color: var(--accent);
		font-size: var(--fs-md);
	}

	.actions li,
	.conditions li {
		padding: var(--sp-4) var(--sp-4);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
	}

	.line {
		display: flex;
		justify-content: space-between;
		gap: var(--sp-4);
	}

	.uses {
		font-size: var(--fs-xs);
		color: var(--accent);
	}

	.actions p {
		margin: var(--sp-2) 0 0;
		font-size: var(--fs-sm);
		color: var(--muted);
	}

	.actions .summary {
		color: var(--text);
	}

	.conditions li {
		font-size: var(--fs-sm);
	}
</style>
