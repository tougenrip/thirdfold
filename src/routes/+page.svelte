<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { asset, resolve } from '$app/paths';
	import { NAME_MAX_LENGTH, ROOM_ID_PATTERN } from '$lib/game/protocol';
	import {
		RoomConnection,
		handOff,
		type ConnectionError,
		type EnterIntent
	} from '$lib/net/room-connection.svelte';
	import type { SavedScene } from '$lib/game/protocol';
	import { listSaves } from '$lib/net/saves';
	import { listGames } from '$lib/net/library';
	import type { PublicGame } from '$lib/game/library';
	import { loadGmKey, loadName, saveGmKey, saveName } from '$lib/prefs';
	import { lastPlayed } from '$lib/ui/when';
	import { sharedCode } from '$lib/ui/share';
	import { prefetchRenderer } from '$lib/tabletop/load';

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

	/** A shared table this link opens (`?table=<code>`), if any. */
	const sharedTable = $derived(sharedCode(page.url.href));

	/** Opens a new table, as its GM, on a table someone shared. */
	function openShared(event: SubmitEvent) {
		event.preventDefault();
		if (!canCreate || !sharedTable) return;
		enter({
			type: 'create',
			name: name.trim(),
			...(gmKey ? { gmKey } : {}),
			continueFrom: sharedTable
		});
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

	/** Games their GMs listed for anyone to join. */
	let games = $state<PublicGame[] | null>(null);
	let gamesError = $state<string | null>(null);

	function refreshGames() {
		gamesError = null;
		listGames().then(
			(list) => (games = list),
			(err: Error) => (gamesError = err.message)
		);
	}

	$effect(() => refreshGames());

	function joinGame(game: PublicGame, role: 'player' | 'spectator') {
		if (canCreate) enter({ type: 'join', roomId: game.roomId, name: name.trim(), role });
	}

	// The table's 3D renderer is the biggest download: fetch it while the visitor is still here.
	$effect(() => prefetchRenderer());
</script>

<main>
	<header class="leaf crest">
		<h1>
			<!-- The book opens and its map unfolds; the still mark for anyone who prefers less motion. -->
			<picture>
				<source
					srcset={asset('/brand/thirdfold-mark.svg')}
					media="(prefers-reduced-motion: reduce)"
				/>
				<img class="mark" src={asset('/brand/thirdfold-mark-animated.svg')} alt="" />
			</picture>
			thirdfold
		</h1>
		<p class="tagline">A shared 3D tabletop for your game night.</p>
	</header>

	<div class="layout">
		<div class="leaf play">
			<label class="field">
				<span>Your name</span>
				<input
					bind:value={name}
					maxlength={NAME_MAX_LENGTH}
					autocomplete="nickname"
					placeholder="e.g. Morgan"
				/>
			</label>

			{#if sharedTable}
				<form class="continue" aria-labelledby="shared-title" onsubmit={openShared}>
					<h2 id="shared-title">A table to run</h2>
					<p class="where">
						Someone shared a table they built. Open your own copy of it as its Game Master.
					</p>
					<button class="primary" type="submit" disabled={!canCreate}>Open the table</button>
					{#if !name.trim()}<p class="hint">Enter your name above to open it.</p>{/if}
				</form>
			{/if}

			{#if latest}
				<section class="continue" aria-labelledby="continue-title">
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
							class="code"
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
						class="ghost watch"
						disabled={!canJoin}
						onclick={() => enter({ type: 'join', roomId, name: name.trim(), role: 'spectator' })}
					>
						Just watch instead
					</button>
				</form>
			</div>
		</div>

		<aside class="leaf aside">
			<section class="games" aria-labelledby="games-title">
				<div class="games-head">
					<h2 id="games-title">Open games</h2>
					<button type="button" onclick={refreshGames}>Refresh</button>
				</div>
				{#if gamesError}
					<p class="muted">The open games could not be looked up just now: {gamesError}</p>
				{:else if games === null}
					<p class="muted" role="status">Looking for open games…</p>
				{:else if games.length === 0}
					<p class="muted">
						No open games right now. Games are invite-only unless their GM lists them.
					</p>
				{:else}
					<ul class="saves">
						{#each games as game (game.roomId)}
							<li>
								<span>
									<strong>{game.title}</strong>
									<span class="muted">
										GM {game.gm} · {game.players}
										{game.players === 1 ? 'player' : 'players'}{game.status
											? ` · ${game.status}`
											: ''}
									</span>
								</span>
								<span class="actions">
									<button
										type="button"
										disabled={!canCreate}
										onclick={() => joinGame(game, 'player')}
									>
										Join
									</button>
									<button
										type="button"
										class="ghost watch"
										disabled={!canCreate}
										onclick={() => joinGame(game, 'spectator')}
									>
										Watch
									</button>
								</span>
							</li>
						{/each}
					</ul>
					{#if !name.trim()}<p class="hint">Enter your name above to join one.</p>{/if}
				{/if}
			</section>

			<ul class="more" aria-label="More">
				<li>
					<a href={resolve('/library')}>Adventure library</a>
					<span class="muted">Adventures people built, to run for your table.</span>
				</li>
				<li>
					<a href={resolve('/builder')}>Build your own adventure</a>
					<span class="muted">Its places, people, fights, choices and endings, no code needed.</span
					>
				</li>
			</ul>

			<details class="key">
				<summary>Your GM key</summary>
				{#if gmKey}
					<p>
						Your saves are yours by this key. Use it on another device to reach them there. Keep it
						secret, like a password.
					</p>
					<div class="row">
						<button type="button" onclick={copyKey}>{copied ? 'Copied' : 'Copy key'}</button>
						<button type="button" class="ghost" onclick={() => (showKey = !showKey)}>
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
		</aside>
	</div>

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
	.layout {
		display: grid;
		gap: var(--sp-8);
	}

	.play,
	.aside {
		display: grid;
		align-content: start;
		gap: var(--sp-7);
		min-width: 0;
	}

	/* Wide screens: play on the left, the rest of the house on the right. */
	@media (min-width: 60rem) {
		.layout {
			grid-template-columns: minmax(0, 1.65fr) minmax(0, 1fr);
			gap: calc(var(--sp-8) * 1.5);
		}

		.aside {
			/* A hairline down the middle of the gutter. */
			padding-left: calc(var(--sp-8) * 0.75);
			margin-left: calc(var(--sp-8) * -0.75);
			border-left: 1px solid var(--border);
		}
	}

	.more {
		display: grid;
		gap: var(--sp-5);
		margin: 0;
		padding: var(--sp-6) 0 0;
		list-style: none;
		border-top: 1px solid var(--border);
	}

	.more li {
		display: grid;
		gap: var(--sp-1);
	}

	.more a {
		font-family: var(--font-display);
		font-size: var(--fs-lg);
		font-weight: 700;
	}

	.games-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.games h2 {
		margin: 0 0 var(--sp-3);
		font-size: var(--fs-lg);
	}

	.actions {
		display: flex;
		gap: var(--sp-4);
		align-items: center;
	}

	/*
	 * The board unfolds: the crest drops open, then the two leaves swing out on their hinges,
	 * each lit as it turns toward you. Starting a game folds them shut again (app.css).
	 */
	.leaf {
		position: relative;
		transform-style: preserve-3d;
		backface-visibility: hidden;
		animation: unfold-down 1000ms cubic-bezier(0.16, 1, 0.3, 1) both;
		animation-delay: var(--delay, 0ms);
	}

	.leaf::after {
		content: '';
		position: absolute;
		inset: calc(var(--sp-4) * -1);
		pointer-events: none;
		border-radius: var(--radius-lg);
		background: linear-gradient(var(--shade-dir, 180deg), rgba(8, 6, 4, 0.95), rgba(8, 6, 4, 0.55));
		animation: unshade 1000ms cubic-bezier(0.16, 1, 0.3, 1) both;
		animation-delay: var(--delay, 0ms);
	}

	.crest {
		animation-name: unfold-down;
		transform-origin: 50% 100%;
		view-transition-name: tf-crest;
	}

	.play {
		animation-name: unfold-down;
		--delay: 160ms;
		transform-origin: 50% 0;
		view-transition-name: tf-play;
	}

	.aside {
		animation-name: unfold-down;
		--delay: 300ms;
		transform-origin: 50% 0;
		view-transition-name: tf-aside;
	}

	@keyframes unfold-down {
		from {
			transform: perspective(1400px) rotateX(-88deg);
		}
	}

	@keyframes unfold-up {
		from {
			transform: perspective(1400px) rotateX(88deg);
		}
	}

	@keyframes unfold-left {
		from {
			transform: perspective(1800px) rotateY(88deg);
		}
	}

	@keyframes unfold-right {
		from {
			transform: perspective(1800px) rotateY(-88deg);
		}
	}

	@keyframes unshade {
		to {
			opacity: 0;
			visibility: hidden;
		}
	}

	/* On a wide screen it is a board: the leaves swing out sideways from the centre hinge. */
	@media (min-width: 60rem) {
		.crest {
			animation-name: unfold-up;
		}

		.play {
			animation-name: unfold-left;
			--shade-dir: 90deg;
			transform-origin: 100% 50%;
		}

		.aside {
			animation-name: unfold-right;
			--shade-dir: 270deg;
			transform-origin: 0 50%;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.leaf,
		.leaf::after {
			animation: none;
		}

		.leaf::after {
			display: none;
		}
	}

	/* A short page sits in the middle of a tall screen instead of hanging from the top. */
	main {
		max-width: 72rem;
		min-height: 100dvh;
		display: grid;
		align-content: center;
		margin: 0 auto;
		padding: clamp(var(--sp-8), 8vh, calc(var(--sp-8) * 2.5)) clamp(var(--sp-6), 4vw, var(--sp-8))
			calc(var(--sp-8) * 1.5);
	}

	h1 {
		display: flex;
		align-items: flex-end;
		gap: var(--sp-6);
		font-family: var(--font-display);
		font-size: var(--fs-display);
		margin: 0;
		letter-spacing: 0.02em;
	}

	h1 .mark {
		display: block;
		height: 1.9em;
		width: auto;
		margin-bottom: -0.1em;
	}

	.tagline {
		color: var(--muted);
		font-size: var(--fs-lg);
		margin: var(--sp-2) 0 calc(var(--sp-8) * 1.25);
		max-width: 65ch;
	}

	.field {
		display: grid;
		gap: var(--sp-3);
		max-width: 20rem;
	}

	.field span {
		color: var(--muted);
		font-size: var(--fs-sm);
	}

	.cards {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
		gap: var(--sp-6);
	}

	.continue {
		display: grid;
		gap: var(--sp-3);
		padding: var(--sp-6);
		border: 1px solid var(--accent);
		border-radius: var(--radius-md);
		background: var(--panel-solid);
	}

	.continue h2 {
		margin: 0;
		font-size: var(--fs-xl);
	}

	.continue p {
		margin: 0;
	}

	.continue .primary {
		justify-self: start;
		margin-top: var(--sp-3);
	}

	.where,
	.party,
	.hint,
	.muted {
		color: var(--muted);
		font-size: var(--fs-sm);
	}

	.saves {
		display: grid;
		gap: var(--sp-3);
		margin: var(--sp-4) 0 0;
		padding: 0;
		list-style: none;
	}

	.saves li {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: var(--sp-4);
	}

	.saves li > span:first-child {
		display: grid;
		min-width: 0;
	}

	.key {
		color: var(--muted);
		font-size: var(--fs-sm);
	}

	.key .row {
		display: flex;
		gap: var(--sp-3);
		margin-top: var(--sp-3);
	}

	.key input {
		flex: 1;
	}

	.shown {
		display: block;
		margin-top: var(--sp-3);
		font-family: var(--font-mono);
		word-break: break-all;
	}

	.watch {
		justify-self: start;
		text-decoration: underline;
		font-size: var(--fs-sm);
	}

	.card {
		display: grid;
		gap: var(--sp-5);
		align-content: start;
		padding: var(--sp-6);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		background: var(--panel-solid);
	}

	.card h2 {
		margin: 0;
		font-size: var(--fs-lg);
	}

	.card p {
		margin: 0;
		color: var(--muted);
	}

	.row {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: var(--sp-4);
	}

	.code {
		text-transform: uppercase;
		letter-spacing: 0.15em;
		font-family: var(--font-mono);
	}

	.code::placeholder {
		font-family: var(--font-ui);
		text-transform: none;
		letter-spacing: normal;
	}

	.status {
		color: var(--muted);
	}
</style>
