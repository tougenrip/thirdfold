<script lang="ts">
	import type { AdventureView, CharacterStatus } from '$lib/adventure/adventure';
	import { CHARACTERS, STATUS_IDS, STATUSES, type StatusId } from '$lib/adventure/characters';
	import { NARRATION_MAX_LENGTH } from '$lib/game/chat';
	import type { PublicPlayer } from '$lib/game/protocol';
	import type { RoomAction } from '$lib/net/room-connection.svelte';

	interface Props {
		adventure: AdventureView | null;
		isGm: boolean;
		players: readonly PublicPlayer[];
		send(action: RoomAction): boolean;
	}

	let { adventure, isGm, players, send }: Props = $props();

	let narration = $state('');
	/** The character the GM is adjusting. */
	let editing = $state<string | null>(null);

	function adjust(
		c: CharacterStatus,
		patch: { hp?: number; revive?: true; statuses?: StatusId[] }
	) {
		send({ type: 'adventure_override', characterId: c.id, patch });
	}

	function toggleStatus(c: CharacterStatus, id: StatusId) {
		const now = c.statuses.map((s) => s.id);
		adjust(c, { statuses: now.includes(id) ? now.filter((s) => s !== id) : [...now, id] });
	}

	const playerName = (id: string | null) =>
		(id && players.find((p) => p.id === id)?.name) ?? 'the GM';
	const party = $derived(adventure?.characters.filter((c) => c.inPlay) ?? []);
	const STAGE_LABEL: Record<AdventureView['stage'], string> = {
		choosing: 'Choosing characters',
		arrival: 'Arrival',
		investigate: 'Investigating',
		encounter: 'Encounter',
		aftermath: 'Aftermath',
		complete: 'Section complete',
		defeat: 'The party has fallen'
	};

	function start() {
		const warning = 'Start The Hollow Bell? This replaces everything on the table.';
		if (confirm(warning)) send({ type: 'adventure_start' });
	}

	function control(op: 'restart' | 'end') {
		const warning =
			op === 'restart'
				? 'Start this section over? The table and the story reset; everyone keeps their character.'
				: 'End the adventure? The table stays as it is, but the story stops.';
		if (confirm(warning)) send({ type: 'adventure_control', op });
	}

	function narrate(event: SubmitEvent) {
		event.preventDefault();
		const text = narration.trim();
		if (text && send({ type: 'adventure_narrate', text })) narration = '';
	}
</script>

{#if adventure}
	<section class="adventure" aria-label="Adventure">
		<header>
			<h2>{adventure.title}</h2>
			<p class="section">
				{adventure.section} · <span class="stage">{STAGE_LABEL[adventure.stage]}</span>
			</p>
		</header>

		<ul class="objectives" aria-label="Objectives">
			{#each adventure.objectives as o (o.id)}
				<li class:done={o.done}>
					<span class="mark" aria-hidden="true">{o.done ? '✓' : '◆'}</span>
					<span>{o.text}</span>
				</li>
			{/each}
		</ul>

		{#if party.length}
			<ul class="party" aria-label="Party">
				{#each party as c (c.id)}
					<li class:downed={c.downed || c.dead}>
						<div class="member">
							<span class="swatch" style:background={CHARACTERS[c.id].color}></span>
							<span class="who">
								{CHARACTERS[c.id].name}
								<small>
									{playerName(c.playerId)}{c.statuses.length
										? ` · ${c.statuses.map((s) => STATUSES[s.id].name).join(', ')}`
										: ''}
								</small>
							</span>
							<span class="hp" title="Hit points">
								{c.dead ? 'Dead' : c.downed ? 'Down' : `${c.hp}/${c.maxHp}`}
							</span>
							{#if isGm}
								<button
									type="button"
									class="edit"
									aria-expanded={editing === c.id}
									title="Adjust this character"
									onclick={() => (editing = editing === c.id ? null : c.id)}>±</button
								>
							{/if}
						</div>
						{#if isGm && editing === c.id}
							<div class="override" aria-label={`Adjust ${CHARACTERS[c.id].name}`}>
								<div class="row">
									{#each [-5, -1, 1, 5] as delta (delta)}
										<button
											type="button"
											disabled={c.dead}
											onclick={() =>
												adjust(c, { hp: Math.max(0, Math.min(c.maxHp, c.hp + delta)) })}
										>
											{delta > 0 ? `+${delta}` : delta}
										</button>
									{/each}
									<button
										type="button"
										disabled={c.dead}
										onclick={() => adjust(c, { hp: c.maxHp })}
									>
										Full
									</button>
								</div>
								<div class="row">
									{#each STATUS_IDS as id (id)}
										<button
											type="button"
											aria-pressed={c.statuses.some((s) => s.id === id)}
											title={STATUSES[id].about}
											onclick={() => toggleStatus(c, id)}
										>
											{STATUSES[id].name}
										</button>
									{/each}
									{#if c.dead}
										<button type="button" onclick={() => adjust(c, { revive: true })}>Revive</button
										>
									{/if}
								</div>
							</div>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}

		{#if adventure.clues.length}
			<details class="clues" open>
				<summary>Clues ({adventure.clues.length})</summary>
				<ul>
					{#each adventure.clues as clue (clue.id)}
						<li>
							<strong>{clue.title}</strong>
							<p>{clue.text}</p>
						</li>
					{/each}
				</ul>
			</details>
		{/if}

		{#if isGm}
			<div class="gm">
				{#if adventure.stage === 'choosing'}
					<button
						class="primary"
						type="button"
						disabled={party.length === 0}
						onclick={() => send({ type: 'adventure_begin' })}
					>
						Begin the adventure
					</button>
					<p class="note">
						{party.length === 0
							? 'Waiting for players to choose their characters.'
							: `${party.length} of 4 characters chosen. Begin when everyone is ready.`}
					</p>
				{/if}
				{#if adventure.encounter?.phase === 'players'}
					<button
						type="button"
						onclick={() => send({ type: 'adventure_control', op: 'end_round' })}
					>
						End the players' turn
					</button>
				{/if}

				<form class="narrate" onsubmit={narrate}>
					<label for="narration">Narrate to the table</label>
					<textarea
						id="narration"
						bind:value={narration}
						maxlength={NARRATION_MAX_LENGTH}
						rows="2"
						placeholder="Describe what they see, hear, feel…"></textarea>
					<button type="submit" disabled={!narration.trim()}>Narrate</button>
				</form>

				{#if adventure.cues?.length}
					<details class="cues">
						<summary>Read aloud</summary>
						<ul>
							{#each adventure.cues as cue (cue.id)}
								<li>
									<button
										type="button"
										class:read={cue.read}
										title={cue.text}
										onclick={() => send({ type: 'adventure_cue', cueId: cue.id })}
									>
										{cue.title}
									</button>
								</li>
							{/each}
						</ul>
					</details>
				{/if}

				<div class="row">
					<button type="button" onclick={() => control('restart')}>Start section over</button>
					<button type="button" onclick={() => control('end')}>End adventure</button>
				</div>
			</div>
		{/if}
	</section>
{:else if isGm}
	<section class="adventure" aria-label="Adventure">
		<h2>Adventure</h2>
		<div class="offer">
			<strong>The Hollow Bell</strong>
			<p>
				A bell that hasn't rung in forty years rings at dusk. A fantasy adventure for 1–4 players.
				Part one: Bellweather.
			</p>
			<button class="primary" type="button" onclick={start}>Start The Hollow Bell</button>
		</div>
	</section>
{/if}

<style>
	.adventure {
		display: grid;
		gap: 0.6rem;
	}

	h2 {
		margin: 0;
		font-size: 0.8rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--muted);
	}

	header h2 {
		font-size: 1rem;
		text-transform: none;
		letter-spacing: 0;
		color: var(--accent);
	}

	.section {
		margin: 0.15rem 0 0;
		font-size: 0.8rem;
		color: var(--muted);
	}

	.stage {
		color: var(--text);
	}

	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.3rem;
	}

	.objectives li {
		display: flex;
		gap: 0.45rem;
		font-size: 0.9rem;
	}

	.objectives .mark {
		color: var(--accent);
		flex: none;
	}

	.objectives .done {
		color: var(--muted);
		text-decoration: line-through;
	}

	.objectives .done .mark {
		color: var(--ok);
	}

	.party .member {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.9rem;
	}

	.override {
		display: grid;
		gap: 0.3rem;
		margin: 0.35rem 0 0.2rem 1.2rem;
	}

	.override button,
	.edit {
		padding: 0.15rem 0.45rem;
		font-size: 0.8rem;
	}

	.override [aria-pressed='true'] {
		border-color: var(--accent);
		color: var(--accent);
	}

	.party .downed {
		opacity: 0.55;
	}

	.swatch {
		width: 0.7rem;
		height: 0.7rem;
		border-radius: 50%;
		flex: none;
	}

	.who {
		flex: 1;
		min-width: 0;
		display: grid;
	}

	.who small {
		color: var(--muted);
		font-size: 0.75rem;
	}

	.hp {
		font-variant-numeric: tabular-nums;
		font-size: 0.85rem;
	}

	details summary {
		cursor: pointer;
		font-size: 0.85rem;
		color: var(--muted);
	}

	.clues ul {
		margin-top: 0.4rem;
		gap: 0.5rem;
	}

	.clues p {
		margin: 0.15rem 0 0;
		font-size: 0.85rem;
		color: var(--muted);
	}

	.gm {
		display: grid;
		gap: 0.5rem;
		padding-top: 0.5rem;
		border-top: 1px solid var(--border);
	}

	.note {
		margin: 0;
		font-size: 0.8rem;
		color: var(--muted);
	}

	.narrate {
		display: grid;
		gap: 0.35rem;
	}

	.narrate label {
		font-size: 0.8rem;
		color: var(--muted);
	}

	textarea {
		font: inherit;
		color: inherit;
		background: #120e0b;
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 0.45rem 0.6rem;
		resize: vertical;
	}

	.cues ul {
		margin-top: 0.4rem;
	}

	.cues button {
		width: 100%;
		text-align: left;
		padding: 0.35rem 0.6rem;
	}

	.cues button.read {
		color: var(--muted);
	}

	.row {
		display: flex;
		gap: 0.4rem;
		flex-wrap: wrap;
	}

	.row button {
		flex: 1;
		padding: 0.4rem 0.5rem;
		font-size: 0.85rem;
	}

	.offer {
		display: grid;
		gap: 0.4rem;
	}

	.offer p {
		margin: 0;
		font-size: 0.85rem;
		color: var(--muted);
	}
</style>
