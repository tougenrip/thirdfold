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
	import Steps from '$lib/ui/Steps.svelte';
	import { prefetchRenderer } from '$lib/tabletop/load';

	const roomId = $derived(page.params.id?.toUpperCase() ?? '');
	const validId = $derived(ROOM_ID_PATTERN.test(roomId));

	let conn = $state<RoomConnection | null>(null);
	let name = $state(loadName());

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

	function join(event: SubmitEvent | null, role: JoinRole) {
		event?.preventDefault();
		const trimmed = name.trim();
		if (!trimmed) return;
		saveName(trimmed);
		conn?.close();
		const intent: EnterIntent = { type: 'join', roomId, name: trimmed, role };
		conn = new RoomConnection(intent);
	}

	// The table's 3D renderer is the biggest download: fetch it while the visitor is still here.
	$effect(() => prefetchRenderer());
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
		<Steps current={1} />
		<h1>You’re invited to play</h1>
		<p class="room-id">Room <span class="num">{roomId}</span></p>
		{#if errorCode === 'session_not_found'}
			<p>Your previous seat in this room has expired. Join again to carry on.</p>
		{:else}
			<p>Tell the table your name, and you’ll pick a character next.</p>
		{/if}
		<form onsubmit={(e) => join(e, 'player')}>
			<label class="field">
				<span>Your name</span>
				<!-- svelte-ignore a11y_autofocus -->
				<input
					bind:value={name}
					maxlength={NAME_MAX_LENGTH}
					placeholder="e.g. Morgan"
					autocomplete="nickname"
					autofocus
				/>
			</label>
			<button class="primary" type="submit" disabled={!name.trim()}>Join the game</button>
		</form>
		<button
			type="button"
			class="watch ghost"
			disabled={!name.trim()}
			onclick={() => join(null, 'spectator')}
		>
			Just watch instead
		</button>
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
		padding: 5rem var(--sp-6);
	}

	.notice form {
		display: grid;
		grid-template-columns: 1fr auto;
		align-items: end;
		gap: var(--sp-4);
		margin-top: var(--sp-7);
	}

	.notice h1 {
		margin: var(--sp-7) 0 var(--sp-2);
	}

	.room-id {
		margin: 0 0 var(--sp-3);
		color: var(--muted);
		font-size: var(--fs-sm);
	}

	.field {
		display: grid;
		gap: var(--sp-3);
	}

	.field span {
		color: var(--muted);
		font-size: var(--fs-sm);
	}

	.watch {
		margin-top: var(--sp-5);
		text-decoration: underline;
		font-size: var(--fs-sm);
	}
</style>
