<script lang="ts">
	import { CONTENT_PACK_MAX_BYTES } from '$lib/game/file-limits';
	import {
		COLLECTION_FORMAT,
		COLLECTION_FORMAT_VERSION,
		COLLECTION_LIMITS,
		type AdventureRef,
		type TableRef
	} from '$lib/game/collection';
	import {
		LIBRARY_LIMITS,
		normalizeCreatorName,
		type BuiltInStory,
		type LibraryKind,
		type MyAdventure
	} from '$lib/game/library';
	import type { LibraryOp } from '$lib/game/protocol';
	import { listMine, manageAdventure, publishAdventure } from '$lib/net/library';
	import { loadCreatorName, loadGmKey, saveCreatorName } from '$lib/prefs';
	import { sharedCode } from '$lib/ui/share';

	/**
	 * A creator's corner of the library: publish homebrew packs, gather
	 * adventures, homebrew and tables into a collection, and look after what
	 * they published. Everything is checked by the server; this only gathers.
	 */
	interface Props {
		/** The adventures that come with thirdfold, to put in a collection. */
		builtIn: readonly BuiltInStory[];
		/** A collection was published: the page shows it. */
		onPublished?(id: string): void;
	}

	let { builtIn, onPublished }: Props = $props();

	let gmKey = $state(loadGmKey());
	let creator = $state(loadCreatorName());
	let mine = $state<MyAdventure[]>([]);
	let busy = $state(false);
	let message = $state<string | null>(null);
	let error = $state<string | null>(null);

	// The collection being gathered.
	let title = $state('');
	let about = $state('');
	/** Chosen adventures in the order chosen: built-in ids and library ids. */
	let chosen = $state<string[]>([]);
	let packs = $state<string[]>([]);
	let tables = $state<TableRef[]>([]);
	let tableName = $state('');
	let tableCode = $state('');

	const ownAdventures = $derived(mine.filter((m) => m.kind === 'adventure'));
	const ownPacks = $derived(mine.filter((m) => m.kind === 'pack'));
	const ownCollections = $derived(mine.filter((m) => m.kind === 'collection'));
	const KIND_WORD: Record<LibraryKind, string> = {
		adventure: 'adventure',
		pack: 'homebrew',
		collection: 'collection'
	};

	$effect(() => {
		const key = gmKey;
		if (!key) return void (mine = []);
		listMine(key).then(
			(list) => (mine = list),
			(err: Error) => (error = err.message)
		);
	});

	function name(): string | null {
		const n = normalizeCreatorName(creator);
		if (!n) error = 'Enter the name to publish under.';
		else saveCreatorName(n);
		return n;
	}

	function toggle(list: string[], id: string, max: number): string[] {
		return list.includes(id)
			? list.filter((x) => x !== id)
			: list.length < max
				? [...list, id]
				: list;
	}

	async function publish(kind: LibraryKind, file: unknown, done: (version: number) => string) {
		const n = name();
		if (!n) return null;
		busy = true;
		error = message = null;
		try {
			const out = await publishAdventure({ gmKey, creator: n, file, kind });
			gmKey = out.gmKey;
			message = done(out.version);
			mine = await listMine(out.gmKey);
			return out.adventureId;
		} catch (err) {
			error = (err as Error).message;
			return null;
		} finally {
			busy = false;
		}
	}

	async function publishPack(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		if (file.size > CONTENT_PACK_MAX_BYTES)
			return void (error = 'That homebrew file is too large.');
		let data: unknown;
		try {
			data = JSON.parse(await file.text());
		} catch {
			return void (error = 'That file is not a homebrew pack (not JSON).');
		}
		await publish('pack', data, (v) =>
			v === 1 ? 'Published your homebrew.' : `Published version ${v} of your homebrew.`
		);
	}

	function addTable() {
		const code = sharedCode(tableCode);
		const label = tableName.trim();
		if (!code)
			return void (error =
				'Paste a shared table’s link or code (Share table, in the Scene panel).');
		if (!label) return void (error = 'Give the table a name.');
		if (tables.some((t) => t.code === code)) return void (error = 'That table is already in it.');
		tables = [...tables, { code, name: label.slice(0, COLLECTION_LIMITS.tableName) }];
		tableName = tableCode = '';
		error = null;
	}

	/** A chosen adventure as the collection names it, at its latest version. */
	function refOf(id: string): AdventureRef {
		const own = ownAdventures.find((a) => a.id === id);
		return own ? { library: own.id, version: own.version } : { builtIn: id };
	}
	const titleOf = (id: string) =>
		ownAdventures.find((a) => a.id === id)?.title ?? builtIn.find((b) => b.id === id)?.title ?? id;

	async function publishCollection() {
		if (!title.trim()) return void (error = 'Give the collection a title.');
		if (!chosen.length) return void (error = 'Choose at least one adventure.');
		const id = await publish(
			'collection',
			{
				format: COLLECTION_FORMAT,
				formatVersion: COLLECTION_FORMAT_VERSION,
				title: title.trim(),
				about: about.trim(),
				adventures: chosen.map(refOf),
				packs: packs.map((p) => ({
					library: p,
					version: ownPacks.find((x) => x.id === p)!.version
				})),
				tables
			},
			() => `Published “${title.trim()}”. GMs can find it among the collections.`
		);
		if (id) {
			title = about = '';
			chosen = packs = [];
			tables = [];
			onPublished?.(id);
		}
	}

	async function manage(item: MyAdventure, op: LibraryOp) {
		if (!gmKey) return;
		if (
			op === 'remove' &&
			!confirm(`Remove “${item.title}” and all its versions from the library?`)
		)
			return;
		error = message = null;
		try {
			mine = await manageAdventure(gmKey, item.id, op);
		} catch (err) {
			error = (err as Error).message;
		}
	}
</script>

<section class="workshop" aria-labelledby="workshop-title">
	<div class="shelf-head">
		<h2 id="workshop-title">Your homebrew and collections</h2>
		<p class="muted">
			Publish a homebrew pack, then gather adventures, homebrew and shared tables into a collection
			for a whole campaign. Every piece is checked before anyone can run it.
		</p>
	</div>

	<label class="field">
		<span>Publish as</span>
		<input bind:value={creator} maxlength={LIBRARY_LIMITS.creatorName} placeholder="Your name" />
	</label>

	<div class="columns">
		<div class="part">
			<h3>Homebrew</h3>
			<p class="muted small">
				A homebrew pack file (see the format in docs/HOMEBREW.md): weapons, armor, spells and
				monsters for the fifth edition rules.
			</p>
			<label class="file-offer" class:disabled={busy}>
				Publish homebrew from a file…
				<input
					type="file"
					accept=".json,application/json"
					hidden
					disabled={busy}
					onchange={publishPack}
				/>
			</label>
		</div>

		<form
			class="part"
			onsubmit={(e) => {
				e.preventDefault();
				void publishCollection();
			}}
		>
			<h3>New collection</h3>
			<label class="field">
				<span>Title</span>
				<input bind:value={title} maxlength={COLLECTION_LIMITS.title} />
			</label>
			<label class="field">
				<span>About</span>
				<textarea bind:value={about} maxlength={COLLECTION_LIMITS.about} rows="2"></textarea>
			</label>
			<fieldset>
				<legend>Adventures, in the order they are played ({chosen.length})</legend>
				{#each [...builtIn.map( (b) => ({ id: b.id, title: b.title, note: 'comes with thirdfold' }) ), ...ownAdventures.map( (a) => ({ id: a.id, title: a.title, note: `yours, version ${a.version}` }) )] as a (a.id)}
					<label class="option">
						<input
							type="checkbox"
							checked={chosen.includes(a.id)}
							onchange={() => (chosen = toggle(chosen, a.id, COLLECTION_LIMITS.adventures))}
						/>
						{#if chosen.includes(a.id)}<span class="order">{chosen.indexOf(a.id) + 1}</span>{/if}
						{a.title} <span class="muted small">{a.note}</span>
					</label>
				{/each}
				{#if chosen.length}
					<p class="muted small">It starts with {titleOf(chosen[0])}, whose rules it plays by.</p>
				{/if}
			</fieldset>
			<fieldset>
				<legend>Homebrew ({packs.length})</legend>
				{#each ownPacks as p (p.id)}
					<label class="option">
						<input
							type="checkbox"
							checked={packs.includes(p.id)}
							onchange={() => (packs = toggle(packs, p.id, COLLECTION_LIMITS.packs))}
						/>
						{p.title} <span class="muted small">version {p.version}</span>
					</label>
				{:else}
					<p class="muted small">Publish homebrew first to add it here.</p>
				{/each}
			</fieldset>
			<fieldset>
				<legend>Tables ({tables.length})</legend>
				{#each tables as t (t.code)}
					<p class="table-line">
						{t.name}
						<button
							type="button"
							class="ghost link"
							onclick={() => (tables = tables.filter((x) => x.code !== t.code))}>Remove</button
						>
					</p>
				{/each}
				<div class="table-add">
					<input
						bind:value={tableName}
						placeholder="Name"
						maxlength={COLLECTION_LIMITS.tableName}
					/>
					<input bind:value={tableCode} placeholder="Shared table link or code" />
					<button type="button" onclick={addTable}>Add</button>
				</div>
			</fieldset>
			<button class="primary" type="submit" disabled={busy}>
				{busy ? 'Publishing…' : 'Publish the collection'}
			</button>
		</form>
	</div>

	{#if message}<p class="ok" role="status">{message}</p>{/if}
	{#if error}<p class="error" role="alert">{error}</p>{/if}

	{#if ownPacks.length || ownCollections.length}
		<h3>Published</h3>
		<ul class="mine">
			{#each [...ownCollections, ...ownPacks] as item (item.id)}
				<li>
					<span>
						<strong>{item.title}</strong>
						<span class="muted small"
							>{KIND_WORD[item.kind]} · version {item.version}{item.listed
								? ''
								: ' · not in the library'}</span
						>
					</span>
					<span class="actions">
						<button type="button" onclick={() => manage(item, item.listed ? 'unlist' : 'list')}>
							{item.listed ? 'Take out' : 'Put back'}
						</button>
						<button type="button" class="danger" onclick={() => manage(item, 'remove')}>
							Remove
						</button>
					</span>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<style>
	.workshop {
		display: grid;
		gap: var(--sp-5);
		margin-top: var(--sp-8);
	}
	.shelf-head h2 {
		margin: 0;
	}
	.shelf-head p {
		margin: var(--sp-3) 0 0;
		max-width: 65ch;
	}
	h3 {
		margin: 0;
		font-size: var(--fs-md);
	}
	.columns {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 2fr);
		gap: var(--sp-6);
		align-items: start;
	}
	@media (max-width: 48rem) {
		.columns {
			grid-template-columns: minmax(0, 1fr);
		}
	}
	.part {
		display: grid;
		gap: var(--sp-4);
		padding: var(--sp-5);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		background: var(--panel-sunk);
	}
	.field {
		display: grid;
		gap: var(--sp-2);
		font-size: var(--fs-sm);
		max-width: 28rem;
	}
	.field > span {
		color: var(--muted);
	}
	fieldset {
		border: 0;
		padding: 0;
		margin: 0;
		display: grid;
		gap: var(--sp-2);
	}
	legend {
		font-size: var(--fs-sm);
		color: var(--muted);
		margin-bottom: var(--sp-2);
	}
	.option {
		display: flex;
		align-items: baseline;
		gap: var(--sp-3);
		font-size: var(--fs-sm);
	}
	.order {
		font-size: var(--fs-xs);
		min-width: 1.2em;
		text-align: center;
		border-radius: var(--radius-pill);
		background: var(--accent-wash);
	}
	.table-add {
		display: flex;
		flex-wrap: wrap;
		gap: var(--sp-3);
	}
	.table-add input {
		flex: 1;
		min-width: 9rem;
	}
	.table-line {
		margin: 0;
		font-size: var(--fs-sm);
	}
	.muted {
		color: var(--muted);
	}
	.small {
		font-size: var(--fs-xs);
	}
	.file-offer {
		cursor: pointer;
		text-decoration: underline;
		font-size: var(--fs-sm);
	}
	.file-offer.disabled {
		opacity: 0.6;
		pointer-events: none;
	}
	.mine {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: var(--sp-3);
	}
	.mine li {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: var(--sp-3);
		padding: var(--sp-3) 0;
		border-bottom: 1px solid var(--border);
	}
	.mine li > span:first-child {
		display: grid;
		gap: var(--sp-1);
	}
	.actions {
		display: flex;
		gap: var(--sp-3);
	}
	.ok {
		color: var(--ok);
	}
	.error {
		color: var(--danger);
	}
</style>
