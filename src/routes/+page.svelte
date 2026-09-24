<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { NAME_MAX_LENGTH, ROOM_ID_PATTERN } from '$lib/game/protocol';
	import {
		RoomConnection,
		handOff,
		type ConnectionError,
		type EnterIntent
	} from '$lib/net/room-connection.svelte';
	import type { SavedScene } from '$lib/game/protocol';
	import { listSaves } from '$lib/net/saves';
	import { loadGmKey, loadName, saveGmKey, saveName } from '$lib/prefs';
	import { lastPlayed } from '$lib/ui/when';

	let name = $state(loadName());
	let code = $state('');
	let pending = $state<RoomConnection | null>(null);
	let error = $state<string | null>(null);

	const busy = $derived(pending !== null);

	/** This browser's GM key, and the saves it holds on the server (newest first). */
	let gmKey = $state(loadGmKey());
	let saves = $state<SavedScene[] | null>(null);
	let savesError = $state<string | null>(null);
	const latest = $derived(saves?.[0] ?? null);

	$effect(() => {
		const key = gmKey;
		if (!key) return;
		saves = null;
		savesError = null;
		listSaves(key).then(
			(list) => gmKey === key && (saves = list),
			(err: Error) => gmKey === key && (savesError = err.message)
		);
	});

	let pastedKey = $state('');
	let showKey = $state(false);
	let copied = $state(false);

	function useKey(event: SubmitEvent) {
		event.preventDefault();
		const key = pastedKey.trim().toLowerCase();
		if (!saveGmKey(key)) {
			error = 'That is not a GM key (64 letters and digits).';
			return;
		}
		error = null;
		pastedKey = '';
		gmKey = key;
	}

	async function copyKey() {
		if (!gmKey) return;
		try {
			await navigator.clipboard.writeText(gmKey);
			copied = true;
			setTimeout(() => (copied = false), 1500);
		} catch {
			showKey = true;
		}
	}

	/** Opens a new table on one of the GM's saves. */
	function continueFrom(scene: SavedScene) {
		if (!canCreate || !gmKey) return;
		enter({ type: 'create', name: name.trim(), gmKey, continueFrom: scene.id });
	}

	const roomId = $derived(code.trim().toUpperCase());
	const canCreate = $derived(name.trim().length > 0 && !busy);
	const canJoin = $derived(canCreate && ROOM_ID_PATTERN.test(roomId));

	async function enter(intent: EnterIntent) {
		error = null;
		saveName(name.trim());
		const conn = new RoomConnection(intent);
		pending = conn;
		try {
			await conn.ready();
			handOff(conn);
			await goto(resolve('/room/[id]', { id: conn.room!.id }));
		} catch (err) {
			conn.close();
			const e = err as ConnectionError;
			if (e.code !== 'closed') error = e.message;
		} finally {
			if (pending === conn) pending = null;
		}
	}

	function create(event: SubmitEvent) {
		event.preventDefault();
		if (canCreate) enter({ type: 'create', name: name.trim(), ...(gmKey ? { gmKey } : {}) });
	}

	function join(event: SubmitEvent) {
		event.preventDefault();
		if (canJoin) enter({ type: 'join', roomId, name: name.trim(), role: 'player' });
	}
</script>

<main>
	<h1>thirdfold</h1>
	<p class="tagline">A shared 3D tabletop for your game night.</p>

	<label class="field">
		<span>Your name</span>
		<input
			bind:value={name}
			maxlength={NAME_MAX_LENGTH}
			autocomplete="nickname"
			placeholder="e.g. Morgan"
		/>
	</label>

	{#if latest}
		<section class="continue" aria-labelledby="continue-title">
			<p class="kicker">Continue</p>
			<h2 id="continue-title">{latest.story?.title ?? latest.name}</h2>
			{#if latest.story && !latest.auto && latest.name !== latest.story.title}
				<p class="where">{latest.name}</p>
			{/if}
			<p class="when">Last played: <strong>{lastPlayed(latest.savedAt)}</strong></p>
			{#if latest.story}
				<p class="where">{latest.story.chapter} · {latest.story.location}</p>
				{#if latest.story.party.length}
					<p class="party">{latest.story.party.join(', ')}</p>
				{/if}
			{/if}
			<button
				class="primary"
				type="button"
				disabled={!canCreate}
				onclick={() => continueFrom(latest)}
			>
				Continue
			</button>
			{#if !name.trim()}<p class="hint">Enter your name above to continue.</p>{/if}
			{#if saves && saves.length > 1}
				<details>
					<summary>Your other saves ({saves.length - 1})</summary>
					<ul class="saves">
						{#each saves.slice(1) as scene (scene.id)}
							<li>
								<span>
									<strong>{scene.story?.title ?? scene.name}</strong>
									<span class="muted">
										{lastPlayed(scene.savedAt)}{scene.story
											? ` · ${scene.story.chapter}`
											: ''}{scene.auto ? ' · autosave' : ''}
									</span>
								</span>
								<button type="button" disabled={!canCreate} onclick={() => continueFrom(scene)}>
									Continue
								</button>
							</li>
						{/each}
					</ul>
				</details>
			{/if}
		</section>
	{:else if savesError}
		<p class="muted">Your saves could not be looked up just now: {savesError}</p>
	{/if}

	<div class="cards">
		<form class="card" onsubmit={create}>
			<h2>Run a game</h2>
			<p>Create a room and become its Game Master.</p>
			<button class="primary" type="submit" disabled={!canCreate}>Create room</button>
		</form>

		<form class="card" onsubmit={join}>
			<h2>Join a game</h2>
			<div class="row">
				<input
					bind:value={code}
					placeholder="Room code"
					aria-label="Room code"
					maxlength="6"
					autocapitalize="characters"
					spellcheck="false"
				/>
			</div>
			<button type="submit" disabled={!canJoin}>Join room</button>
			<button
				type="button"
				class="watch"
				disabled={!canJoin}
				onclick={() => enter({ type: 'join', roomId, name: name.trim(), role: 'spectator' })}
			>
				Just watch instead
			</button>
		</form>
	</div>

	<details class="key">
		<summary>Your GM key</summary>
		{#if gmKey}
			<p>
				Your saves are yours by this key. Use it on another device to reach them there. Keep it
				secret, like a password.
			</p>
			<div class="row">
				<button type="button" onclick={copyKey}>{copied ? 'Copied' : 'Copy key'}</button>
				<button type="button" onclick={() => (showKey = !showKey)}>
					{showKey ? 'Hide' : 'Show'}
				</button>
			</div>
			{#if showKey}<code class="shown">{gmKey}</code>{/if}
		{:else}
			<p>You get one the first time you run a game from this browser.</p>
		{/if}
		<form class="row" onsubmit={useKey}>
			<input
				bind:value={pastedKey}
				placeholder="Paste a key from another device"
				aria-label="GM key from another device"
				spellcheck="false"
				autocomplete="off"
			/>
			<button type="submit" disabled={!pastedKey.trim()}>Use key</button>
		</form>
	</details>

	{#if pending}
		<p class="status" aria-live="polite">
			{pending.error?.message ?? 'Connecting…'}
			<button type="button" onclick={() => pending?.close()}>Cancel</button>
		</p>
	{/if}
	{#if error}
		<p class="error" role="alert">{error}</p>
	{/if}
</main>

<style>
	main {
		max-width: 44rem;
		margin: 0 auto;
		padding: 4rem 1rem 2rem;
	}

	h1 {
		font-size: 2.6rem;
		margin: 0;
		letter-spacing: 0.02em;
	}

	.tagline {
		color: var(--muted);
		margin: 0.3rem 0 2rem;
	}

	.field {
		display: grid;
		gap: 0.35rem;
		max-width: 20rem;
		margin-bottom: 1.5rem;
	}

	.field span {
		color: var(--muted);
		font-size: 0.9rem;
	}

	.cards {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
		gap: 1rem;
	}

	.continue {
		display: grid;
		gap: 0.4rem;
		margin-bottom: 1rem;
		padding: 1.2rem;
		border: 1px solid var(--accent);
		border-radius: 10px;
		background: var(--panel-solid);
	}

	.continue h2 {
		margin: 0;
		font-size: 1.5rem;
	}

	.continue p {
		margin: 0;
	}

	.continue .primary {
		justify-self: start;
		margin-top: 0.4rem;
	}

	.kicker,
	.where,
	.party,
	.hint,
	.muted {
		color: var(--muted);
		font-size: 0.9rem;
	}

	.kicker {
		text-transform: uppercase;
		letter-spacing: 0.08em;
		font-size: 0.8rem;
	}

	.saves {
		display: grid;
		gap: 0.4rem;
		margin: 0.5rem 0 0;
		padding: 0;
		list-style: none;
	}

	.saves li {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.5rem;
	}

	.saves li span {
		display: grid;
	}

	.key {
		margin-top: 1.5rem;
		color: var(--muted);
		font-size: 0.9rem;
	}

	.key .row {
		display: flex;
		gap: 0.4rem;
		margin-top: 0.4rem;
	}

	.key input {
		flex: 1;
	}

	.shown {
		display: block;
		margin-top: 0.4rem;
		word-break: break-all;
	}

	.watch {
		justify-self: start;
		padding: 0;
		border: none;
		background: none;
		color: var(--muted);
		text-decoration: underline;
		font-size: 0.85rem;
	}

	.card {
		display: grid;
		gap: 0.75rem;
		align-content: start;
		padding: 1.2rem;
		border: 1px solid var(--border);
		border-radius: 10px;
		background: var(--panel-solid);
	}

	.card h2 {
		margin: 0;
		font-size: 1.15rem;
	}

	.card p {
		margin: 0;
		color: var(--muted);
	}

	.row {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 0.5rem;
	}

	.row input {
		text-transform: uppercase;
		letter-spacing: 0.15em;
	}

	.status {
		color: var(--muted);
	}
</style>
