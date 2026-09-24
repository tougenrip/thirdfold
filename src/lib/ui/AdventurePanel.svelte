<script lang="ts">
	import {
		EVIDENCE_KINDS,
		type AdventureView,
		type CharacterStatus,
		type ObjectState
	} from '$lib/adventure/adventure';
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
	const STAGE_LABEL: Record<AdventureView['stage'], string | null> = {
		choosing: 'Choosing characters',
		playing: null,
		complete: 'The end',
		defeat: 'The party has fallen'
	};
	/** Story events as the GM reads them: well_clue → well clue. */
	const eventLabel = (id: string) => id.replace(/_/g, ' ');

	function start() {
		const warning = 'Start The Hollow Bell? This replaces everything on the table.';
		if (confirm(warning)) send({ type: 'adventure_start' });
	}

	function control(op: 'restart' | 'end') {
		const warning =
			op === 'restart'
				? 'Start the story over from the beginning? The table and the story reset; everyone keeps their character.'
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
				Chapter {adventure.chapter.number} of {adventure.chapter.of} ·
				<span class="stage">{STAGE_LABEL[adventure.stage] ?? adventure.chapter.title}</span>
			</p>
			<p class="section">{adventure.location.name}</p>
		</header>

		<ul class="objectives" aria-label="Objectives">
			{#each adventure.objectives as o (o.id)}
				<li class:done={o.done} class:optional={o.optional}>
					<span class="mark" aria-hidden="true">{o.done ? '✓' : o.optional ? '◇' : '◆'}</span>
					<span
						>{o.text}{#if o.optional}<small class="opt">(optional)</small>{/if}</span
					>
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
				<summary>Evidence ({adventure.clues.length})</summary>
				<ul>
					{#each adventure.clues as clue (clue.id)}
						<li class:secret={!clue.shared}>
							<span class="evidence-kind">{EVIDENCE_KINDS[clue.kind]}</span>
							<strong>{clue.title}</strong>
							<p>{clue.text}</p>
							{#if !clue.shared}
								<p class="who-knows">
									{clue.mine ? 'Only you know this.' : `Known only to ${clue.foundBy.join(', ')}.`}
								</p>
								{#if clue.mine || isGm}
									<button
										type="button"
										onclick={() => send({ type: 'adventure_share', clueId: clue.id })}
									>
										Share with the party
									</button>
								{/if}
							{/if}
						</li>
					{/each}
				</ul>
			</details>
		{/if}

		{#if adventure.rewards.length}
			<details class="clues" open>
				<summary>Rewards ({adventure.rewards.length})</summary>
				<ul aria-label="Rewards">
					{#each adventure.rewards as reward (reward)}
						<li><strong>{reward}</strong></li>
					{/each}
				</ul>
			</details>
		{/if}

		{#if adventure.decisions.length}
			<details class="clues">
				<summary>Choices made ({adventure.decisions.length})</summary>
				<ul>
					{#each adventure.decisions as d (d.id)}
						<li>
							<strong>{d.choice}</strong>
							<p>{d.prompt} ({d.by})</p>
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
				{#if adventure.encounter}
					{@const up = adventure.encounter.order[adventure.encounter.current]}
					<button type="button" onclick={() => send({ type: 'adventure_control', op: 'end_turn' })}>
						End {up ? `${up.name}'s` : 'this'} turn
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

				{#if adventure.objects?.length}
					<details class="world">
						<summary>World objects</summary>
						<ul>
							{#each adventure.objects as o (o.id)}
								<li>
									<label for={`object-${o.id}`}>
										{o.name}
										<small>{o.kind}</small>
									</label>
									<select
										id={`object-${o.id}`}
										value={o.state}
										class:hidden-state={o.state === 'hidden'}
										onchange={(e) =>
											send({
												type: 'adventure_object',
												objectId: o.id,
												state: e.currentTarget.value as ObjectState
											})}
									>
										{#each o.states as state (state)}
											<option value={state}>{state}</option>
										{/each}
									</select>
								</li>
							{/each}
						</ul>
					</details>
				{/if}

				{#if adventure.ledger}
					<details class="ledger">
						<summary>Story state</summary>
						<dl>
							<dt>Events</dt>
							<dd>
								{adventure.ledger.events.length
									? adventure.ledger.events.map(eventLabel).join(', ')
									: 'none yet'}
							</dd>
							<dt>People</dt>
							<dd>
								<ul class="people">
									{#each adventure.ledger.npcs as n (n.id)}
										<li>
											{n.name} <em>{n.state}</em>
											<small>{n.home}</small>
										</li>
									{/each}
								</ul>
							</dd>
							<dt>Fights</dt>
							<dd>
								{adventure.ledger.encounters.length
									? adventure.ledger.encounters.map((e) => `${e.id}: ${e.state}`).join(', ')
									: 'none yet'}
							</dd>
							<dt>Defeated</dt>
							<dd>
								{adventure.ledger.defeated.length ? adventure.ledger.defeated.join(', ') : 'none'}
							</dd>
						</dl>
					</details>
				{/if}

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
					<button type="button" onclick={() => control('restart')}>Start story over</button>
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
				A bell that hasn't rung in forty years rings at dusk. A fantasy adventure for 1–4 players,
				from the village of Bellweather to the monastery above it, and what lies beneath.
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

	.ledger dl {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 0.25rem 0.6rem;
		margin: 0.4rem 0 0;
		font-size: 0.8rem;
	}

	.ledger dt {
		color: var(--muted);
	}

	.ledger dd {
		margin: 0;
	}

	.people {
		gap: 0.15rem;
	}

	.people em {
		color: var(--accent);
		font-style: normal;
	}

	.people small {
		display: block;
		color: var(--muted);
	}

	.objectives .opt {
		margin-left: 0.3em;
	}

	.objectives .optional:not(.done) {
		color: var(--muted);
	}

	.evidence-kind {
		display: block;
		font-size: 0.65rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--muted);
	}

	.clues .secret {
		padding-left: 0.5rem;
		border-left: 2px solid var(--accent);
	}

	.clues .who-knows {
		color: var(--accent);
		font-size: 0.8rem;
	}

	.clues button {
		margin-top: 0.3rem;
		padding: 0.15rem 0.5rem;
		font-size: 0.8rem;
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

	.world ul {
		margin-top: 0.4rem;
	}

	.world li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		font-size: 0.85rem;
	}

	.world label {
		display: grid;
		min-width: 0;
	}

	.world small {
		color: var(--muted);
		font-size: 0.75rem;
	}

	.world select {
		padding: 0.2rem 0.35rem;
		font-size: 0.8rem;
	}

	.world .hidden-state {
		color: var(--muted);
		font-style: italic;
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
