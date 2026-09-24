<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { NAME_MAX_LENGTH } from '$lib/game/protocol';
	import {
		CREATOR_ID_PATTERN,
		LIBRARY_LIMITS,
		type Creator,
		type LibraryListing,
		type LibrarySort
	} from '$lib/game/library';
	import { RoomConnection, handOff, type ConnectionError } from '$lib/net/room-connection.svelte';
	import { listLibrary } from '$lib/net/library';
	import { loadGmKey, loadName, saveName } from '$lib/prefs';
	import { describePlays, describeRating } from '$lib/ui/rating';
	import { lastPlayed } from '$lib/ui/when';
	import { prefetchRenderer } from '$lib/tabletop/load';

	/** A creator's page (`?creator=<id>`), else the whole library. */
	const creatorId = $derived.by(() => {
		const id = page.url.searchParams.get('creator');
		return id && CREATOR_ID_PATTERN.test(id) ? id : null;
	});

	let name = $state(loadName());
	let query = $state('');
	let sort = $state<LibrarySort>('top');
	let adventures = $state<LibraryListing[] | null>(null);
	let creator = $state<Creator | null>(null);
	let error = $state<string | null>(null);
	let starting = $state<string | null>(null);

	// Look again a moment after the search stops changing.
	$effect(() => {
		const q = { query, sort, creator: creatorId ?? undefined };
		const timer = setTimeout(() => {
			listLibrary(q).then(
				(found) => {
					adventures = found.adventures;
					creator = found.creator;
					error = null;
				},
				(err: Error) => (error = err.message)
			);
		}, 250);
		return () => clearTimeout(timer);
	});

	const canPlay = $derived(name.trim().length > 0 && starting === null);

	/** Opens a new table as its GM with this adventure set up on it. */
	async function play(listing: LibraryListing) {
		if (!canPlay) return;
		error = null;
		saveName(name.trim());
		starting = listing.id;
		const gmKey = loadGmKey();
		const conn = new RoomConnection({
			type: 'create',
			name: name.trim(),
			...(gmKey ? { gmKey } : {})
		});
		try {
			await conn.ready();
			conn.send({ type: 'adventure_start', libraryId: listing.id });
			handOff(conn);
			await goto(resolve('/room/[id]', { id: conn.room!.id }));
		} catch (err) {
			conn.close();
			const e = err as ConnectionError;
			if (e.code !== 'closed') error = e.message;
		} finally {
			starting = null;
		}
	}

	$effect(() => prefetchRenderer());
</script>

<main>
	<p class="back"><a href={resolve('/')}>← thirdfold</a></p>
	{#if creatorId}
		<h1>{creator?.name ?? 'A creator'}</h1>
		<p class="tagline">
			Adventures by {creator?.name ?? 'this creator'}.
			<a href={resolve('/library')}>The whole library</a>
		</p>
	{:else}
		<h1>Adventure library</h1>
		<p class="tagline">
			Adventures people built in thirdfold. Pick one and run it for your table.
			<a href={resolve('/builder')}>Build and publish your own</a>
		</p>
	{/if}

	<div class="controls">
		<label class="field">
			<span>Your name</span>
			<input
				bind:value={name}
				maxlength={NAME_MAX_LENGTH}
				autocomplete="nickname"
				placeholder="e.g. Morgan"
			/>
		</label>
		<label class="field grow">
			<span>Search</span>
			<input
				bind:value={query}
				maxlength={LIBRARY_LIMITS.query}
				type="search"
				placeholder="Title, story or creator"
			/>
		</label>
		<label class="field">
			<span>Order</span>
			<select bind:value={sort}>
				<option value="top">Best rated</option>
				<option value="played">Most played</option>
				<option value="new">Newest</option>
			</select>
		</label>
	</div>

	{#if error}<p class="error" role="alert">{error}</p>{/if}

	{#if adventures === null}
		<p class="muted">Looking…</p>
	{:else if adventures.length === 0}
		<p class="muted">
			{query.trim() ? 'Nothing matches that search.' : 'Nothing has been published here yet.'}
		</p>
	{:else}
		<ul class="list">
			{#each adventures as a (a.id)}
				<li class="card">
					<h2>{a.title}</h2>
					<p class="meta">
						by <a href={resolve(`/library?creator=${a.creator.id}`)}>{a.creator.name}</a>
						· version {a.version} · updated {lastPlayed(a.publishedAt)}
					</p>
					{#if a.about}<p>{a.about}</p>{/if}
					<p class="meta">{describeRating(a.rating)} · {describePlays(a.plays)}</p>
					<button
						class="primary"
						type="button"
						disabled={!canPlay}
						onclick={() => play(a)}
						aria-label={`Run ${a.title}`}
					>
						{starting === a.id ? 'Opening…' : 'Run it'}
					</button>
				</li>
			{/each}
		</ul>
		{#if !name.trim()}<p class="muted">Enter your name above to run one.</p>{/if}
	{/if}
</main>

<style>
	main {
		max-width: 52rem;
		margin: 0 auto;
		padding: 2rem 1rem;
	}

	.back {
		margin: 0 0 1rem;
	}

	h1 {
		margin: 0;
		font-size: 2.2rem;
	}

	.tagline,
	.muted,
	.meta {
		color: var(--muted);
	}

	.tagline {
		margin: 0.3rem 0 1.5rem;
	}

	.controls {
		display: flex;
		flex-wrap: wrap;
		gap: 0.8rem;
		margin-bottom: 1.2rem;
	}

	.field {
		display: grid;
		gap: 0.3rem;
		font-size: 0.9rem;
	}

	.field span {
		color: var(--muted);
	}

	.grow {
		flex: 1;
		min-width: 12rem;
	}

	.list {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(18rem, 1fr));
		gap: 1rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.card {
		display: grid;
		gap: 0.45rem;
		align-content: start;
		padding: 1.1rem;
		border: 1px solid var(--border);
		border-radius: 10px;
		background: var(--panel-solid);
	}

	.card h2 {
		margin: 0;
		font-size: 1.2rem;
	}

	.card p {
		margin: 0;
	}

	.meta {
		font-size: 0.85rem;
	}

	.card .primary {
		justify-self: start;
		margin-top: 0.3rem;
	}
</style>
