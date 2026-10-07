<script lang="ts">
	import type { MonsterListing } from '$lib/adventure/adventure';
	import type { AdventurePreview } from '$lib/adventure/preview';
	import { searchBestiary } from '$lib/net/library';
	import { DND_PREGENS, pregenChoices } from '$lib/rules/dnd55e/pregens';
	import { addPregen, DND_RULES, withRules, type Draft } from './draft';

	/**
	 * The rules an adventure plays by and what they bring (milestone 57): the
	 * fifth edition's party, built by the rules from ready-made choices,
	 * whether players may bring their own, and monsters from the SRD's
	 * bestiary. The server builds and checks all of it; `preview` is what it
	 * made of the draft the last time the creator asked.
	 */
	interface Props {
		draft: Draft;
		preview: AdventurePreview | null;
		/** The server's answer is about the draft as it is now. */
		current: boolean;
		checking: boolean;
		onCheck(): void;
	}

	let { draft = $bindable(), preview, current, checking, onCheck }: Props = $props();

	const dnd = $derived(draft.rules?.id === DND_RULES.id);
	const party = $derived(Object.entries(draft.party ?? {}));

	type Choices = { name?: string; color?: string; class?: { id?: string } };
	const choicesOf = (id: string) => (draft.party![id].choices ?? {}) as Choices;
	const classOf = (id: string) => (choicesOf(id).class?.id ?? '').split(':').pop() ?? '';

	function switchRules(toDnd: boolean) {
		if (toDnd === dnd) return;
		if (
			!toDnd &&
			party.length &&
			!confirm('Go back to the classic rules? The party and monsters go.')
		)
			return;
		draft = withRules(draft, toDnd);
	}

	let pregen = $state(DND_PREGENS[0].id);

	// Monsters: searched in the rules' bestiary on the server.
	let query = $state('');
	let results = $state<MonsterListing[]>([]);
	let searching = $state(false);
	let searchError = $state<string | null>(null);
	/** What each kind added is, as the search found it. */
	let known = $state<Record<string, MonsterListing>>({});
	async function search(e: SubmitEvent) {
		e.preventDefault();
		searching = true;
		searchError = null;
		try {
			results = await searchBestiary(draft.rules ?? DND_RULES, query.trim());
			for (const m of results) known[m.kind] = m;
		} catch (err) {
			searchError = (err as Error).message;
		} finally {
			searching = false;
		}
	}
	function addMonster(kind: string) {
		const list = (draft.monsters ??= []);
		if (!list.includes(kind)) list.push(kind);
	}
	function removeMonster(kind: string) {
		draft.monsters = (draft.monsters ?? []).filter((k) => k !== kind);
		if (!draft.monsters.length) delete draft.monsters;
	}
	const monsterName = (kind: string) =>
		known[kind]?.name ?? preview?.monsters.find((m) => m.kind === kind)?.name ?? kind;
	const short = (hash: string) => hash.slice(0, 8);
</script>

<section>
	<h2>Rules and party</h2>
	<fieldset>
		<legend>It plays by</legend>
		<label class="check">
			<input type="radio" checked={!dnd} onchange={() => switchRules(false)} />
			thirdfold’s classic rules <span class="muted">(the classic characters, four stats)</span>
		</label>
		<label class="check">
			<input type="radio" checked={dnd} onchange={() => switchRules(true)} />
			Fifth edition (SRD 5.2.1)
			<span class="muted">(abilities and skills, saving throws, rests, gear, SRD monsters)</span>
		</label>
	</fieldset>

	{#if !dnd}
		<p class="muted">The classic characters are picked in the Overview.</p>
	{:else}
		<h3>The party</h3>
		<p class="muted">
			Characters the rules build from these choices, level 1, checked by the server. Rename them,
			give them a colour and an introduction.
		</p>
		{#each party as [id] (id)}
			{@const c = choicesOf(id)}
			<div class="member">
				<div class="row">
					<code>{id}</code>
					<span class="muted">{classOf(id)}</span>
					<span class="spacer"></span>
					<button
						type="button"
						onclick={() => {
							delete draft.party![id];
							if (!Object.keys(draft.party!).length) delete draft.party;
						}}>Remove</button
					>
				</div>
				<div class="row">
					<label class="field grow">
						<span>Name</span>
						<input
							value={c.name ?? ''}
							maxlength="40"
							onchange={(e) =>
								((draft.party![id].choices as Choices).name = e.currentTarget.value.trim())}
						/>
					</label>
					<label class="field">
						<span>Colour</span>
						<input
							type="color"
							value={c.color ?? '#888888'}
							onchange={(e) =>
								((draft.party![id].choices as Choices).color = e.currentTarget.value)}
						/>
					</label>
				</div>
				<label class="field">
					<span>Introduction</span>
					<textarea
						rows="2"
						maxlength="600"
						value={draft.party![id].intro ?? ''}
						onchange={(e) => {
							const v = e.currentTarget.value.trim();
							if (v) draft.party![id].intro = v;
							else delete draft.party![id].intro;
						}}></textarea>
				</label>
			</div>
		{/each}
		<div class="row">
			<select aria-label="A ready-made character" bind:value={pregen}>
				{#each DND_PREGENS as p (p.id)}<option value={p.id}>{p.label}</option>{/each}
			</select>
			<button type="button" onclick={() => addPregen(draft, pregenChoices(pregen))}
				>Add to the party</button
			>
		</div>
		<label class="check">
			<input
				type="checkbox"
				checked={!!draft.openParty}
				onchange={(e) => {
					if (e.currentTarget.checked) draft.openParty = true;
					else delete draft.openParty;
				}}
			/>
			Players may also build their own characters
		</label>

		<h3>Monsters</h3>
		<p class="muted">
			From the SRD’s bestiary, played by the table as the rules read them. Fights name them by kind.
		</p>
		{#if draft.monsters?.length}
			<ul class="monsters">
				{#each draft.monsters as kind (kind)}
					<li>
						{monsterName(kind)} <code>{kind}</code>
						<button type="button" onclick={() => removeMonster(kind)}>Remove</button>
					</li>
				{/each}
			</ul>
		{/if}
		<form class="row" onsubmit={search}>
			<input
				aria-label="Search the bestiary"
				placeholder="Name, type or challenge: skeleton, undead, 1/4"
				maxlength="60"
				bind:value={query}
			/>
			<button type="submit" disabled={searching}>{searching ? 'Searching…' : 'Search'}</button>
		</form>
		{#if searchError}<p class="error" role="alert">{searchError}</p>{/if}
		{#if results.length}
			<ul class="results">
				{#each results as m (m.kind)}
					<li>
						<div>
							<strong>{m.name}</strong>
							<span class="muted"
								>{m.type}, challenge {m.challenge}: AC {m.armorClass}, {m.hitPoints} HP</span
							>
						</div>
						<div class="muted small">{m.attacks.join(' · ')}</div>
						<button
							type="button"
							disabled={draft.monsters?.includes(m.kind)}
							onclick={() => addMonster(m.kind)}>Add</button
						>
					</li>
				{/each}
			</ul>
		{/if}
	{/if}

	<h3>What it comes to</h3>
	<div class="row">
		<button type="button" disabled={checking} onclick={onCheck}>
			{checking ? 'Asking…' : 'Check on the server'}
		</button>
		{#if preview && !current}<span class="muted">The draft has changed since.</span>{/if}
	</div>
	{#if preview}
		<dl>
			<dt>Rules</dt>
			<dd>{preview.rules.name} <span class="muted">v{preview.rules.version}</span></dd>
			{#each preview.content as c (c.id)}
				<dt>Content</dt>
				<dd>
					{c.name}
					<span class="muted"
						>{c.name.includes(c.version) ? '' : `${c.version} · `}build {short(c.build)}</span
					>
				</dd>
			{/each}
		</dl>
		{#if preview.party.length}
			<table>
				<thead><tr><th>Character</th><th>HP</th><th>Defence</th><th>Speed</th></tr></thead>
				<tbody>
					{#each preview.party as p (p.id)}
						<tr>
							<td>{p.name} <span class="muted">{p.title ?? ''}</span></td>
							<td>{p.hp}</td>
							<td>{p.defense.name} {p.defense.value}</td>
							<td>{p.speed}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
		{#if preview.openParty}<p class="muted">Players may build their own too.</p>{/if}
		{#each preview.monsters as m (m.kind)}
			<p class="monster">
				<strong>{m.name}</strong>
				<span class="muted">challenge {m.challenge}, AC {m.armorClass}, {m.hitPoints} HP</span><br
				/>
				<span class="small">{m.attacks.join(' · ')}</span>
				{#if m.notPlayed.length}<br /><span class="small muted"
						>Not played yet: {m.notPlayed.join(', ')}</span
					>{/if}
			</p>
		{/each}
		{#if preview.attribution}<p class="small muted">{preview.attribution}</p>{/if}
	{:else}
		<p class="muted">
			The server builds the party and finds the monsters; ask it to see the numbers the rules give
			them.
		</p>
	{/if}
</section>

<style>
	.row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--sp-2);
		align-items: center;
		margin: var(--sp-2) 0;
	}
	.spacer {
		flex: 1;
	}
	.grow {
		flex: 1;
	}
	.member {
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		padding: var(--sp-2) var(--sp-3);
		margin-bottom: var(--sp-2);
	}
	ul {
		margin: 0;
		padding-left: var(--sp-4);
		display: grid;
		gap: var(--sp-1);
	}
	.results {
		list-style: none;
		padding: 0;
	}
	.results li {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 0 var(--sp-2);
		border-bottom: 1px solid var(--border);
		padding: var(--sp-1) 0;
	}
	.results li > :global(div:nth-child(2)) {
		grid-column: 1;
	}
	.results li button {
		grid-row: 1 / span 2;
		grid-column: 2;
		align-self: center;
	}
	dl {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: var(--sp-1) var(--sp-3);
	}
	dt {
		color: var(--muted);
	}
	dd {
		margin: 0;
	}
	table {
		border-collapse: collapse;
		width: 100%;
		font-size: var(--fs-sm);
	}
	th,
	td {
		text-align: left;
		padding: var(--sp-1) var(--sp-2);
		border-bottom: 1px solid var(--border);
	}
	.muted {
		color: var(--muted);
	}
	.small {
		font-size: var(--fs-xs);
	}
	.monster {
		margin: var(--sp-2) 0;
	}
	code {
		font-size: var(--fs-xs);
		overflow-wrap: anywhere;
	}
	input:not([type]) {
		min-width: 0;
		flex: 1;
	}
</style>
