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
	import { loadName, saveName } from '$lib/prefs';

	let name = $state(loadName());
	let code = $state('');
	let pending = $state<RoomConnection | null>(null);
	let error = $state<string | null>(null);

	const busy = $derived(pending !== null);

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
		if (canCreate) enter({ type: 'create', name: name.trim() });
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
