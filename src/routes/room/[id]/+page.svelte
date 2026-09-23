<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { NAME_MAX_LENGTH, ROOM_ID_PATTERN, type JoinRole } from '$lib/game/protocol';
	import {
		RoomConnection,
		savedSession,
		takeHandoff,
		type EnterIntent
	} from '$lib/net/room-connection.svelte';
	import { loadName, saveName } from '$lib/prefs';
	import RoomView from '$lib/ui/RoomView.svelte';

	const roomId = $derived(page.params.id?.toUpperCase() ?? '');
	const validId = $derived(ROOM_ID_PATTERN.test(roomId));

	let conn = $state<RoomConnection | null>(null);
	let name = $state(loadName());
	let role = $state<JoinRole>('player');

	// (Re)attach whenever the room in the URL changes: reuse the connection the
	// landing page opened, else resume a saved seat, else ask the user to join.
	$effect(() => {
		if (!validId) return;
		const id = roomId;
		const token = savedSession(id);
		conn =
			takeHandoff(id) ??
			(token ? new RoomConnection({ type: 'resume', roomId: id, sessionToken: token }) : null);
	});

	// Close each connection once it is replaced or the page unmounts.
	$effect(() => {
		const c = conn;
		return () => c?.close();
	});

	const errorCode = $derived(conn?.status === 'closed' ? conn.error?.code : undefined);
	const roomMissing = $derived(!validId || errorCode === 'room_not_found');
	const needsJoin = $derived(
		validId && !roomMissing && (conn === null || errorCode === 'session_not_found')
	);

	function join(event: SubmitEvent) {
		event.preventDefault();
		const trimmed = name.trim();
		if (!trimmed) return;
		saveName(trimmed);
		conn?.close();
		const intent: EnterIntent = { type: 'join', roomId, name: trimmed, role };
		conn = new RoomConnection(intent);
	}
</script>

<svelte:head>
	<title>{validId ? `Room ${roomId}` : 'Room'} · thirdfold</title>
</svelte:head>

{#if roomMissing}
	<main class="notice">
		<h1>Room not found</h1>
		<p>The room <strong>{roomId}</strong> doesn't exist or has closed.</p>
		<a href={resolve('/')}>Back to start</a>
	</main>
{:else if needsJoin}
	<main class="notice">
		<h1>Join room {roomId}</h1>
		{#if errorCode === 'session_not_found'}
			<p>Your previous seat in this room has expired. Join again to continue.</p>
		{/if}
		<form onsubmit={join}>
			<input
				bind:value={name}
				maxlength={NAME_MAX_LENGTH}
				placeholder="Your name"
				aria-label="Your name"
				autocomplete="nickname"
			/>
			<select bind:value={role} aria-label="Join as">
				<option value="player">Player</option>
				<option value="spectator">Spectator</option>
			</select>
			<button class="primary" type="submit" disabled={!name.trim()}>Join</button>
		</form>
		{#if conn?.error && errorCode !== 'session_not_found'}
			<p class="error" role="alert">{conn.error.message}</p>
		{/if}
	</main>
{:else if conn}
	<RoomView {conn} />
{/if}

<style>
	.notice {
		max-width: 30rem;
		margin: 0 auto;
		padding: 5rem 1rem;
	}

	.notice form {
		display: grid;
		grid-template-columns: 1fr auto auto;
		gap: 0.5rem;
		margin-top: 1rem;
	}

	.notice a {
		color: var(--accent);
	}
</style>
