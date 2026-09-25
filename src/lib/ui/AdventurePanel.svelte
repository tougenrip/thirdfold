<script lang="ts">
	import { resolve } from '$app/paths';
	import {
		EVIDENCE_KINDS,
		type AdventureView,
		type CharacterStatus,
		type ObjectState
	} from '$lib/adventure/adventure';
	import { CHARACTERS, STATUS_IDS, STATUSES, type StatusId } from '$lib/adventure/characters';
	import { NARRATION_MAX_LENGTH } from '$lib/game/chat';
	import type { AdventureListing, PublicPlayer } from '$lib/game/protocol';
	import { ADVENTURE_FILE_MAX_BYTES } from '$lib/adventure/file';
	import type { RoomAction } from '$lib/net/room-connection.svelte';
	import type { LibraryListing } from '$lib/game/library';
	import { listLibrary } from '$lib/net/library';
	import { describeRating } from '$lib/ui/rating';

	interface Props {
		adventure: AdventureView | null;
		isGm: boolean;
		players: readonly PublicPlayer[];
		/** The adventures the server can run, for the GM to pick. */
		adventures?: readonly AdventureListing[];
		send(action: RoomAction): boolean;
		onError?(message: string): void;
	}

	let { adventure, isGm, players, adventures = [], send, onError }: Props = $props();

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

	/** GM, before a story: the library's best rated, to start one from here. */
	let picks = $state<LibraryListing[] | null>(null);
	$effect(() => {
		if (!isGm || adventure) return;
		listLibrary({ sort: 'top' }).then(
			(found) => (picks = found.adventures.slice(0, 5)),
			() => (picks = [])
		);
	});

	function startFromLibrary(listing: LibraryListing) {
		const warning = `Start ${listing.title}? This replaces everything on the table.`;
		if (confirm(warning)) send({ type: 'adventure_start', libraryId: listing.id });
	}

	function start(listing: AdventureListing) {
		const warning = `Start ${listing.title}? This replaces everything on the table.`;
		if (confirm(warning)) send({ type: 'adventure_start', adventureId: listing.id });
	}

	/** Plays an adventure file (made in the builder, or shared by its creator); the server checks it. */
	async function playFile(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		if (file.size > ADVENTURE_FILE_MAX_BYTES) return onError?.('That file is too large.');
		let data: unknown;
		try {
			data = JSON.parse(await file.text());
		} catch {
			return onError?.('That file is not an adventure (not JSON).');
		}
		if (confirm('Start this adventure? This replaces everything on the table.')) {
			send({ type: 'adventure_start', file: data });
		}
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
			{#if adventure.library}
				<p class="section">
					by <a href={resolve(`/library?creator=${adventure.library.creator.id}`)}
						>{adventure.library.creator.name}</a
					>
					· version {adventure.library.version}
				</p>
			{/if}
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
							<span class="hp num" title="Hit points">
								{c.dead ? 'Dead' : c.downed ? 'Down' : `${c.hp}/${c.maxHp}`}
							</span>
							{#if isGm}
								<button
									type="button"
									class="ghost edit"
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
							<strong>{clue.title}</strong>
							<span class="evidence-kind">{EVIDENCE_KINDS[clue.kind]}</span>
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
					<button type="button" class="danger" onclick={() => control('end')}>End adventure</button>
				</div>
			</div>
		{/if}
	</section>
{:else if isGm}
	<section class="adventure" aria-label="Adventure">
		<h2 class="section-title">Adventure</h2>
		<ol class="gm-steps" aria-label="How a game goes">
			<li>Start a story. The table fills in for everyone.</li>
			<li>Send the invite link from the top bar. Each player picks a character.</li>
			<li>Run it from the Direct panel: pause, skip ahead, start fights, bring on foes.</li>
		</ol>
		{#if adventures[0]}
			{@const featured = adventures[0]}
			<div class="offer featured">
				<strong>{featured.title}</strong>
				{#if featured.about}<p>{featured.about}</p>{/if}
				<button class="primary" type="button" onclick={() => start(featured)}>
					Start {featured.title}
				</button>
			</div>
		{/if}
		<details class="more">
			<summary>More adventures</summary>
			<div class="more-list">
				{#each adventures.slice(1) as listing (listing.id)}
					<div class="offer">
						<strong>{listing.title}</strong>
						{#if listing.about}<p>{listing.about}</p>{/if}
						<button type="button" onclick={() => start(listing)}>Start {listing.title}</button>
					</div>
				{/each}
				{#if picks?.length}
					<h3 class="section-title">From the library</h3>
					{#each picks as listing (listing.id)}
						<div class="offer">
							<strong>{listing.title}</strong>
							<p>by {listing.creator.name} · {describeRating(listing.rating)}</p>
							<button type="button" onclick={() => startFromLibrary(listing)}>
								Start {listing.title}
							</button>
						</div>
					{/each}
				{/if}
				<a class="build-link" href={resolve('/library')}>Browse the library</a>
				<label class="file-offer">
					Play an adventure file…
					<input type="file" accept=".json,application/json" hidden onchange={playFile} />
				</label>
				<a class="build-link" href={resolve('/builder')}>Build your own adventure</a>
			</div>
		</details>
	</section>
{/if}

<style>
	.adventure {
		display: grid;
		gap: var(--sp-4);
	}

	.gm-steps {
		margin: 0;
		padding-left: var(--sp-6);
		display: grid;
		gap: var(--sp-2);
		font-size: var(--fs-sm);
		color: var(--muted);
	}

	.gm-steps li::marker {
		font-family: var(--font-display);
		color: var(--accent);
	}

	.more summary {
		cursor: pointer;
		color: var(--muted);
		font-size: var(--fs-sm);
	}

	.more summary:hover {
		color: var(--text);
	}

	.more-list {
		display: grid;
		gap: var(--sp-4);
		margin-top: var(--sp-4);
	}

	.featured strong {
		font-family: var(--font-display);
		font-size: var(--fs-lg);
	}

	h2 {
		margin: 0;
	}

	header h2 {
		font-size: var(--fs-md);
		color: var(--accent);
	}

	.section {
		margin: var(--sp-1) 0 0;
		font-size: var(--fs-xs);
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
		gap: var(--sp-3);
	}

	.objectives li {
		display: flex;
		gap: var(--sp-4);
		font-size: var(--fs-sm);
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
		gap: var(--sp-4);
		font-size: var(--fs-sm);
	}

	.override {
		display: grid;
		gap: var(--sp-3);
		margin: var(--sp-3) 0 var(--sp-2) var(--sp-6);
	}

	.override button,
	.edit {
		padding: var(--sp-1) var(--sp-4);
		font-size: var(--fs-xs);
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
		font-size: var(--fs-xs);
	}

	.hp {
		font-variant-numeric: tabular-nums;
		font-size: var(--fs-sm);
	}

	details summary {
		cursor: pointer;
		font-size: var(--fs-sm);
		color: var(--muted);
	}

	.clues ul {
		margin-top: var(--sp-3);
		gap: var(--sp-4);
	}

	.ledger dl {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: var(--sp-2) var(--sp-4);
		margin: var(--sp-3) 0 0;
		font-size: var(--fs-xs);
	}

	.ledger dt {
		color: var(--muted);
	}

	.ledger dd {
		margin: 0;
	}

	.people {
		gap: var(--sp-1);
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
		margin-left: var(--sp-2);
		font-size: var(--fs-2xs);
		color: var(--muted);
	}

	.clues .secret {
		padding: var(--sp-3) var(--sp-4);
		border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
		border-radius: var(--radius-sm);
		background: var(--accent-wash);
	}

	.clues .who-knows {
		color: var(--accent);
		font-size: var(--fs-xs);
	}

	.clues button {
		margin-top: var(--sp-3);
		padding: var(--sp-1) var(--sp-4);
		font-size: var(--fs-xs);
	}

	.clues p {
		margin: var(--sp-1) 0 0;
		font-size: var(--fs-sm);
		color: var(--muted);
	}

	.gm {
		display: grid;
		gap: var(--sp-4);
		padding-top: var(--sp-4);
		border-top: 1px solid var(--border);
	}

	.note {
		margin: 0;
		font-size: var(--fs-xs);
		color: var(--muted);
	}

	.narrate {
		display: grid;
		gap: var(--sp-3);
	}

	.narrate label {
		font-size: var(--fs-xs);
		color: var(--muted);
	}

	textarea {
		resize: vertical;
	}

	.world ul {
		margin-top: var(--sp-3);
	}

	.world li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--sp-4);
		font-size: var(--fs-sm);
	}

	.world label {
		display: grid;
		min-width: 0;
	}

	.world small {
		color: var(--muted);
		font-size: var(--fs-xs);
	}

	.world select {
		padding: var(--sp-2) var(--sp-3);
		font-size: var(--fs-xs);
	}

	.world .hidden-state {
		color: var(--muted);
		font-style: italic;
	}

	.cues ul {
		margin-top: var(--sp-3);
	}

	.cues button {
		width: 100%;
		text-align: left;
		padding: var(--sp-3) var(--sp-4);
	}

	.cues button.read {
		color: var(--muted);
	}

	.row {
		display: flex;
		gap: var(--sp-3);
		flex-wrap: wrap;
	}

	.row button {
		flex: 1;
		padding: var(--sp-3) var(--sp-4);
		font-size: var(--fs-sm);
	}

	.offer {
		display: grid;
		gap: var(--sp-3);
	}

	.offer p {
		margin: 0;
		font-size: var(--fs-sm);
		color: var(--muted);
	}

	.file-offer {
		cursor: pointer;
		font-size: var(--fs-sm);
		text-decoration: underline;
		color: var(--muted);
	}

	.build-link {
		font-size: var(--fs-sm);
		color: var(--muted);
	}
</style>
