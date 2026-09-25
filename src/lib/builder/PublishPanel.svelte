<script lang="ts">
	import { resolve } from '$app/paths';
	import { LIBRARY_LIMITS, normalizeCreatorName, type MyAdventure } from '$lib/game/library';
	import type { LibraryOp } from '$lib/game/protocol';
	import { listMine, manageAdventure, publishAdventure } from '$lib/net/library';
	import { loadCreatorName, loadGmKey, saveCreatorName } from '$lib/prefs';
	import { describePlays, describeRating } from '$lib/ui/rating';
	import { lastPlayed } from '$lib/ui/when';

	/**
	 * Publishing to the library: the draft as a new adventure, or as the next
	 * version of one of the creator's; and their published adventures, to
	 * list, unlist or remove. They are theirs by this browser's GM key.
	 */
	let {
		file,
		ready,
		title
	}: {
		/** The adventure file as it stands. */
		file: () => unknown;
		/** Whether it passes every check (only playable adventures are published). */
		ready: boolean;
		title: string;
	} = $props();

	const LAST_KEY = 'thirdfold:builder:published';
	const lastPublished = () => {
		try {
			return localStorage.getItem(LAST_KEY);
		} catch {
			return null;
		}
	};

	let gmKey = $state(loadGmKey());
	let creator = $state(loadCreatorName());
	let mine = $state<MyAdventure[] | null>(null);
	/** '' publishes a new adventure; else the id of the one this is a new version of. */
	let target = $state('');
	let busy = $state(false);
	let message = $state<string | null>(null);
	let error = $state<string | null>(null);

	$effect(() => {
		const key = gmKey;
		if (!key) return void (mine = []);
		listMine(key).then(
			(list) => {
				mine = list;
				const last = lastPublished();
				if (last && list.some((a) => a.id === last)) target = last;
			},
			(err: Error) => (error = err.message)
		);
	});

	async function publish() {
		const name = normalizeCreatorName(creator);
		if (!name) return (error = 'Enter the name to publish under.');
		if (!ready) return (error = 'Fix the problems first (see Check).');
		busy = true;
		error = message = null;
		saveCreatorName(name);
		try {
			const done = await publishAdventure({
				gmKey,
				creator: name,
				file: file(),
				...(target ? { adventureId: target } : {})
			});
			gmKey = done.gmKey;
			target = done.adventureId;
			try {
				localStorage.setItem(LAST_KEY, done.adventureId);
			} catch {
				// ignore
			}
			message =
				done.version === 1
					? `Published “${title}”. Anyone can find it in the library now.`
					: `Published version ${done.version} of “${title}”. New games get it; games under way keep theirs.`;
			mine = await listMine(done.gmKey);
		} catch (err) {
			error = (err as Error).message;
		} finally {
			busy = false;
		}
	}

	async function manage(a: MyAdventure, op: LibraryOp) {
		if (!gmKey) return;
		if (op === 'remove' && !confirm(`Remove “${a.title}” and all its versions from the library?`)) {
			return;
		}
		error = message = null;
		try {
			mine = await manageAdventure(gmKey, a.id, op);
			if (op === 'remove' && target === a.id) target = '';
		} catch (err) {
			error = (err as Error).message;
		}
	}
</script>

<section>
	<h2>Publish</h2>
	<p class="muted">
		Put the adventure in the <a href={resolve('/library')}>library</a>, where any GM can find it,
		run it for their table and rate it. Publishing again adds a version: new games get the latest,
		and games already under way keep the one they started with.
	</p>

	<div class="row">
		<label>
			Publish as
			<input
				bind:value={creator}
				maxlength={LIBRARY_LIMITS.creatorName}
				placeholder="Your name as a creator"
				autocomplete="nickname"
			/>
		</label>
		<label>
			Publish
			<select bind:value={target}>
				<option value="">as a new adventure</option>
				{#each mine ?? [] as a (a.id)}
					<option value={a.id}>as version {a.version + 1} of “{a.title}”</option>
				{/each}
			</select>
		</label>
		<button class="primary" type="button" disabled={busy || !ready} onclick={publish}>
			{busy ? 'Publishing…' : 'Publish'}
		</button>
	</div>
	{#if !ready}<p class="muted">Fix the problems in Check to publish it.</p>{/if}
	{#if message}<p class="ok" role="status">{message}</p>{/if}
	{#if error}<p class="error" role="alert">{error}</p>{/if}

	<h3>Your adventures</h3>
	{#if mine === null}
		<p class="muted">Looking…</p>
	{:else if mine.length === 0}
		<p class="muted">You haven’t published any yet.</p>
	{:else}
		<ul class="mine">
			{#each mine as a (a.id)}
				<li>
					<span>
						<strong>{a.title}</strong>
						<span class="muted">
							version {a.version} · {lastPlayed(a.publishedAt)} · {describeRating(a.rating)} · {describePlays(
								a.plays
							)}{a.listed ? '' : ' · not in the library'}
						</span>
					</span>
					<span class="actions">
						{#if a.listed}
							<button type="button" onclick={() => manage(a, 'unlist')}
								>Take out of the library</button
							>
						{:else}
							<button type="button" onclick={() => manage(a, 'list')}
								>Put back in the library</button
							>
						{/if}
						<button type="button" class="danger" onclick={() => manage(a, 'remove')}>Remove</button>
					</span>
				</li>
			{/each}
		</ul>
		<p class="muted">
			<a href={resolve(`/library?creator=${mine[0].creator.id}`)}>Your page in the library</a>
			· Adventures taken out of the library can still be run by you.
		</p>
	{/if}
	{#if !gmKey}
		<p class="muted">
			Your adventures are yours by this browser’s GM key, which you get when you first publish or
			run a game.
		</p>
	{/if}
</section>

<style>
	.row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--sp-4);
		align-items: end;
	}

	label {
		display: grid;
		gap: var(--sp-2);
		font-size: var(--fs-sm);
		color: var(--muted);
	}

	.mine {
		display: grid;
		gap: var(--sp-4);
		padding: 0;
		list-style: none;
	}

	.mine li {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: var(--sp-4);
		flex-wrap: wrap;
	}

	.mine li > span:first-child {
		display: grid;
	}

	.actions {
		display: flex;
		gap: var(--sp-3);
	}

	.muted {
		color: var(--muted);
	}

	.ok {
		color: var(--ok);
	}
</style>
