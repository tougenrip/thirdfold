<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import type { ClientMessage } from '$lib/game/protocol';
	import {
		CREATOR_ID_PATTERN,
		LIBRARY_ID_PATTERN,
		LIBRARY_LIMITS,
		LIBRARY_SORTS,
		type BuiltInStory,
		type Creator,
		type LibraryListing,
		type LibrarySort,
		type StoryDetail
	} from '$lib/game/library';
	import { RoomConnection, handOff, type ConnectionError } from '$lib/net/room-connection.svelte';
	import { listLibrary, openStory } from '$lib/net/library';
	import { loadGmKey, loadName, saveName } from '$lib/prefs';
	import { describeFacts, describePlays } from '$lib/ui/rating';
	import { inSentence, lastPlayed } from '$lib/ui/when';
	import { prefetchRenderer } from '$lib/tabletop/load';
	import LibraryBook from '$lib/ui/LibraryBook.svelte';
	import NameDialog from '$lib/ui/NameDialog.svelte';
	import LibraryStory from '$lib/ui/LibraryStory.svelte';
	import Stars from '$lib/ui/Stars.svelte';

	// Where the reader is, all in the URL so it can be shared or refreshed:
	// `?creator=` a creator's shelf, `?story=` a published adventure opened,
	// `?built=` one that comes with thirdfold, `?q=` a search, `?sort=` an order.
	const params = $derived(page.url.searchParams);
	const creatorId = $derived.by(() => {
		const id = params.get('creator');
		return id && CREATOR_ID_PATTERN.test(id) ? id : null;
	});
	const storyId = $derived.by(() => {
		const id = params.get('story');
		return id && LIBRARY_ID_PATTERN.test(id) ? id : null;
	});
	const builtId = $derived(params.get('built'));

	let query = $state(page.url.searchParams.get('q') ?? '');
	let sort = $state<LibrarySort>(
		LIBRARY_SORTS.find((s) => s === page.url.searchParams.get('sort')) ?? 'top'
	);

	let adventures = $state<LibraryListing[] | null>(null);
	let builtIn = $state<BuiltInStory[]>([]);
	let creator = $state<Creator | null>(null);
	let loading = $state(true);
	let loadError = $state<string | null>(null);
	let attempt = $state(0);

	let detail = $state<StoryDetail | null>(null);
	let detailMissing = $state(false);

	/** The name this browser plays under; asked for the first time someone runs an adventure. */
	let name = $state(loadName());
	let starting = $state<string | null>(null);
	let runError = $state<string | null>(null);
	let pending = $state<Runnable | null>(null);
	let nameDialog = $state<ReturnType<typeof NameDialog> | null>(null);

	type Runnable = { kind: 'library' | 'built'; id: string; title: string };

	/** Keeps the URL in step with the search and order (replacing, not stacking, history). */
	function setParams(next: Record<string, string | null>) {
		const url = new URL(page.url);
		for (const [key, value] of Object.entries(next)) {
			if (value) url.searchParams.set(key, value);
			else url.searchParams.delete(key);
		}
		if (url.search !== page.url.search) {
			void goto(url.search ? resolve(`/library?${url.search.slice(1)}`) : resolve('/library'), {
				replaceState: true,
				keepFocus: true,
				noScroll: true
			});
		}
	}

	// Look again a moment after the search stops changing.
	$effect(() => {
		const q = { query, sort, creator: creatorId ?? undefined };
		void attempt;
		loading = true;
		const timer = setTimeout(() => {
			setParams({ q: query.trim() || null, sort: sort === 'top' ? null : sort });
			listLibrary(q).then(
				(found) => {
					adventures = found.adventures;
					creator = found.creator;
					builtIn = found.builtIn ?? [];
					loadError = null;
					loading = false;
				},
				(err: Error) => {
					loadError = err.message;
					loading = false;
				}
			);
		}, 250);
		return () => clearTimeout(timer);
	});

	// An opened adventure: its opening and facts come from the server.
	$effect(() => {
		const id = storyId;
		detail = null;
		detailMissing = false;
		if (!id) return;
		openStory(id).then(
			(story) => {
				detail = story;
				detailMissing = story === null;
			},
			(err: Error) => (loadError = err.message)
		);
	});

	const shownBuiltIn = $derived.by(() => {
		const q = query.trim().toLowerCase();
		if (creatorId) return [];
		if (!q) return builtIn;
		return builtIn.filter((s) =>
			q.split(/\s+/).every((w) => `${s.title} ${s.about}`.toLowerCase().includes(w))
		);
	});
	const openedBuilt = $derived(builtIn.find((s) => s.id === builtId) ?? null);
	const opened = $derived(storyId !== null || builtId !== null);

	const title = $derived.by(() => {
		if (detail) return detail.listing.title;
		if (openedBuilt) return openedBuilt.title;
		if (creatorId) return creator ? `${creator.name}’s adventures` : 'A creator';
		return 'Adventure library';
	});

	const resultsNote = $derived.by(() => {
		if (loading || loadError || !adventures) return '';
		const n = adventures.length;
		if (n === 0) return query.trim() ? 'No adventures match that search.' : '';
		return `${n} ${n === 1 ? 'adventure' : 'adventures'}${query.trim() ? ' match' : ''}.`;
	});

	/** Runs it straight away if we know the GM's name; asks for it first if not. */
	function run(r: Runnable) {
		runError = null;
		if (name.trim()) return void start(r);
		pending = r;
		nameDialog?.open('');
	}

	function changeName() {
		pending = null;
		nameDialog?.open(name);
	}

	/** A name given in the dialog: remembered, then the adventure it was asked for runs. */
	function named(given: string) {
		name = given;
		saveName(given);
		const r = pending;
		pending = null;
		if (r) void start(r);
	}

	/** Opens a new table as its GM with this adventure set up on it. */
	async function start(r: Runnable) {
		if (starting) return;
		starting = r.id;
		const gmKey = loadGmKey();
		const conn = new RoomConnection({
			type: 'create',
			name: name.trim(),
			...(gmKey ? { gmKey } : {})
		});
		try {
			await conn.ready();
			const begin: ClientMessage =
				r.kind === 'library'
					? { type: 'adventure_start', libraryId: r.id }
					: { type: 'adventure_start', adventureId: r.id };
			conn.send(begin);
			handOff(conn);
			await goto(resolve('/room/[id]', { id: conn.room!.id }));
		} catch (err) {
			conn.close();
			const e = err as ConnectionError;
			if (e.code !== 'closed') runError = e.message;
		} finally {
			starting = null;
		}
	}

	$effect(() => prefetchRenderer());
</script>

<svelte:head>
	<title>{title} · thirdfold</title>
</svelte:head>

{#snippet runButton(r: Runnable, primary: boolean)}
	<button
		type="button"
		class:primary
		class="run"
		disabled={starting !== null}
		onclick={() => run(r)}
	>
		{starting === r.id ? 'Opening…' : 'Run it'}<span class="visually-hidden">: {r.title}</span>
	</button>
{/snippet}

<main>
	<nav class="back">
		{#if opened}
			<a href={resolve('/library')}>← The library</a>
		{:else if creatorId}
			<a href={resolve('/library')}>← The whole library</a>
		{:else}
			<a href={resolve('/')}>← thirdfold</a>
		{/if}
	</nav>

	{#if opened}
		<!-- One adventure, opened. -->
		{#if detail || openedBuilt}
			{@const story = detail
				? {
						kind: 'library' as const,
						id: detail.listing.id,
						title: detail.listing.title,
						about: detail.listing.about,
						opening: detail.opening,
						facts: detail.facts
					}
				: {
						kind: 'built' as const,
						id: openedBuilt!.id,
						title: openedBuilt!.title,
						about: openedBuilt!.about,
						opening: openedBuilt!.opening,
						facts: openedBuilt!.facts
					}}
			<LibraryStory
				id={story.id}
				title={story.title}
				about={story.about}
				opening={story.opening}
				facts={story.facts}
				listing={detail?.listing ?? null}
			>
				{#snippet actions()}
					{@render runButton({ kind: story.kind, id: story.id, title: story.title }, true)}
					{#if name.trim()}
						<p class="muted small">
							You’ll open a table as its GM, as {name.trim()}.
							<button type="button" class="ghost link" onclick={changeName}>Change</button>
						</p>
					{/if}
				{/snippet}
			</LibraryStory>
		{:else if detailMissing || (builtId !== null && !loading)}
			<h1>Adventure not found</h1>
			<p class="muted">
				It may have been taken out of the library. <a href={resolve('/library')}
					>Browse the library</a
				>
			</p>
		{:else}
			<p class="muted" role="status">Opening the adventure…</p>
		{/if}
	{:else}
		<header class="head">
			<h1>{title}</h1>
			{#if creatorId}
				<p class="tagline">
					{creator
						? `Everything ${creator.name} has published to the library.`
						: 'There’s no creator by that link.'}
				</p>
			{:else}
				<p class="tagline">
					Stories to run at your table, as its GM. Pick one and your friends join by link.
					<a href={resolve('/builder')}>Build and publish your own</a>
				</p>
			{/if}
		</header>

		<div class="controls">
			<label class="field grow">
				<span>Search</span>
				<span class="search">
					<input
						bind:value={query}
						maxlength={LIBRARY_LIMITS.query}
						type="search"
						placeholder="Title, story or creator"
					/>
					{#if query}
						<button
							type="button"
							class="ghost clear"
							aria-label="Clear the search"
							onclick={() => (query = '')}>×</button
						>
					{/if}
				</span>
			</label>
			<label class="field">
				<span>Order</span>
				<select bind:value={sort}>
					<option value="top">Best rated</option>
					<option value="played">Most played</option>
					<option value="new">Newest</option>
				</select>
			</label>
			{#if name.trim()}
				<p class="as">
					Running as <strong>{name.trim()}</strong>
					<button type="button" class="ghost link" onclick={changeName}>Change</button>
				</p>
			{/if}
		</div>

		{#if shownBuiltIn.length}
			<section class="shelf" aria-labelledby="built-title">
				<div class="shelf-head">
					<h2 id="built-title">Made with thirdfold</h2>
					<p class="muted">Complete stories, ready on every new table.</p>
				</div>
				<ul class="books">
					{#each shownBuiltIn as s (s.id)}
						<LibraryBook id={s.id} title={s.title} opens={`built=${s.id}`}>
							<p>{describeFacts(s.facts)}</p>
							{#snippet action()}
								{@render runButton({ kind: 'built', id: s.id, title: s.title }, false)}
							{/snippet}
						</LibraryBook>
					{/each}
				</ul>
			</section>
		{/if}

		<section class="shelf" aria-labelledby="community-title">
			<div class="shelf-head">
				<h2 id="community-title">{creatorId ? 'Published' : 'From the community'}</h2>
				<p class="muted" role="status">{resultsNote}</p>
			</div>

			{#if loadError}
				<div class="notice" role="alert">
					<p>The library couldn’t be reached: {loadError}</p>
					<button type="button" onclick={() => attempt++}>Try again</button>
				</div>
			{:else if adventures === null}
				<p class="muted" role="status">Searching the library…</p>
			{:else if adventures.length === 0}
				<p class="muted">
					{#if query.trim()}
						Nothing matches that search. Try a word from the story, or a creator’s name.
					{:else if creatorId}
						{creator?.name ?? 'This creator'} hasn’t published anything to the library yet.
					{:else}
						Nothing has been published here yet. <a href={resolve('/builder')}>Build an adventure</a
						> and publish it: it will be the first.
					{/if}
				</p>
			{:else}
				<ul class="books" class:stale={loading}>
					{#each adventures as a (a.id)}
						<LibraryBook id={a.id} title={a.title} opens={`story=${a.id}`}>
							<p>
								{#if !creatorId}
									by <a class="creator" href={resolve(`/library?creator=${a.creator.id}`)}
										>{a.creator.name}</a
									> ·
								{/if}
								updated {inSentence(lastPlayed(a.publishedAt))}
								{#if a.version > 1}· version {a.version}{/if}
							</p>
							{#if a.about}<p class="about">{a.about}</p>{/if}
							<p><Stars rating={a.rating} /> · {describePlays(a.plays)}</p>
							{#snippet action()}
								{@render runButton({ kind: 'library', id: a.id, title: a.title }, false)}
							{/snippet}
						</LibraryBook>
					{/each}
				</ul>
			{/if}
		</section>
	{/if}

	{#if runError}<p class="error" role="alert">{runError}</p>{/if}
	<p class="visually-hidden" role="status">{starting ? 'Opening a table…' : ''}</p>
</main>

<NameDialog
	bind:this={nameDialog}
	running={pending?.title ?? null}
	onSave={named}
	onCancel={() => (pending = null)}
/>

<style>
	main {
		max-width: 72rem;
		margin: 0 auto;
		padding: var(--sp-8) clamp(var(--sp-6), 4vw, var(--sp-8)) calc(var(--sp-8) * 2);
	}

	.back {
		margin: 0 0 var(--sp-6);
	}

	h1 {
		margin: 0;
		font-size: var(--fs-2xl);
	}

	.tagline,
	.muted,
	.tagline {
		margin: var(--sp-3) 0 0;
		max-width: 65ch;
	}

	.head {
		margin-bottom: var(--sp-7);
	}

	/* The search and order sit above both shelves; they search both. */
	.controls {
		display: flex;
		flex-wrap: wrap;
		align-items: end;
		gap: var(--sp-5);
		margin-bottom: var(--sp-8);
	}

	.field {
		display: grid;
		gap: var(--sp-3);
		font-size: var(--fs-sm);
	}

	.field > span:first-child {
		color: var(--muted);
	}

	.grow {
		flex: 1;
		min-width: 14rem;
		max-width: 32rem;
	}

	.search {
		position: relative;
		display: grid;
	}

	.search input {
		padding-right: 2.5rem;
	}

	/* The browser's own clear control would sit beside ours. */
	.search input::-webkit-search-cancel-button {
		display: none;
	}

	.clear {
		position: absolute;
		right: var(--sp-2);
		top: 50%;
		transform: translateY(-50%);
		min-height: 0;
		padding: var(--sp-2) var(--sp-4);
	}

	.as {
		margin: 0 0 0 auto;
		font-size: var(--fs-sm);
		color: var(--muted);
	}

	.as strong {
		color: var(--text);
		font-weight: 500;
	}

	.link {
		min-height: 0;
		padding: var(--sp-1) var(--sp-3);
		color: var(--accent);
		font-size: inherit;
	}

	/* A shelf: a heading, a line, then books standing in a row. */
	.shelf + .shelf {
		margin-top: calc(var(--sp-8) * 1.5);
	}

	.shelf-head {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: var(--sp-2) var(--sp-5);
		margin-bottom: var(--sp-6);
		padding-bottom: var(--sp-4);
		border-bottom: 1px solid var(--border);
	}

	.shelf-head h2 {
		margin: 0;
		font-size: var(--fs-xl);
	}

	.shelf-head p {
		margin: 0;
		font-size: var(--fs-sm);
	}

	.books {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(13rem, 1fr));
		gap: var(--sp-8) var(--sp-7);
		margin: 0;
		padding: 0;
		list-style: none;
		transition: opacity var(--dur) var(--ease-out);
	}

	/* A search in flight: the last results stay, dimmed, until the new ones arrive. */
	.books.stale {
		opacity: 0.55;
	}

	.notice {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--sp-5);
		padding: var(--sp-5) var(--sp-6);
		border: 1px solid rgba(226, 122, 107, 0.5);
		border-radius: var(--radius-md);
	}

	.notice p {
		margin: 0;
	}

	.small {
		font-size: var(--fs-sm);
	}

	@media (max-width: 48rem) {
		.books {
			grid-template-columns: repeat(auto-fill, minmax(9.5rem, 1fr));
			gap: var(--sp-7) var(--sp-5);
		}

		.as {
			margin-left: 0;
		}

		/* Thumb-sized targets. */
		.link,
		.clear {
			min-height: 2.75rem;
		}

		.creator {
			display: inline-block;
			padding-block: var(--sp-2);
		}
	}
</style>
