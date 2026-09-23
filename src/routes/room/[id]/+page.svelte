<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { NAME_MAX_LENGTH, ROOM_ID_PATTERN, type JoinRole, type Role } from '$lib/game/protocol';
	import {
		RoomConnection,
		savedSession,
		takeHandoff,
		type EnterIntent
	} from '$lib/net/room-connection.svelte';
	import { loadName, saveName } from '$lib/prefs';
	import Tabletop from '$lib/tabletop/Tabletop.svelte';
	import type { CameraView } from '$lib/tabletop/renderer';

	const roomId = $derived(page.params.id?.toUpperCase() ?? '');
	const validId = $derived(ROOM_ID_PATTERN.test(roomId));

	let conn = $state<RoomConnection | null>(null);
	let name = $state(loadName());
	let role = $state<JoinRole>('player');
	let view = $state<CameraView>('tactical');
	let copied = $state(false);

	// (Re)attach whenever the room in the URL changes: reuse the connection the
	// landing page opened, else resume a saved seat, else ask the user to join.
	$effect(() => {
		if (!validId) return;
		const id = roomId;
		const token = savedSession(id);
		conn =
			takeHandoff(id) ?? (token ? new RoomConnection({ type: 'resume', roomId: id, token }) : null);
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

	async function copyInvite() {
		try {
			await navigator.clipboard.writeText(location.href);
			copied = true;
			setTimeout(() => (copied = false), 1500);
		} catch (err) {
			console.warn('[room] clipboard unavailable', err);
		}
	}

	const ROLE_LABEL: Record<Role, string> = { gm: 'GM', player: 'Player', spectator: 'Spectator' };
	const STATUS_LABEL = {
		connecting: 'Connecting…',
		connected: 'Connected',
		reconnecting: 'Reconnecting…',
		closed: 'Disconnected'
	};
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
	<div class="room">
		{#if conn.room}
			<div class="stage">
				<Tabletop grid={conn.room.grid} {view} />
			</div>
		{/if}

		<header class="bar">
			<a class="brand" href={resolve('/')}>thirdfold</a>
			<span class="code" title="Room code">{roomId}</span>
			<button type="button" onclick={copyInvite}
				>{copied ? 'Link copied' : 'Copy invite link'}</button
			>
			<div class="views" role="group" aria-label="Camera">
				<button
					type="button"
					aria-pressed={view === 'tactical'}
					onclick={() => (view = 'tactical')}
				>
					Tactical
				</button>
				<button
					type="button"
					aria-pressed={view === 'tabletop'}
					onclick={() => (view = 'tabletop')}
				>
					Tabletop
				</button>
			</div>
			<span class="status" data-status={conn.status}>{STATUS_LABEL[conn.status]}</span>
		</header>

		{#if conn.room}
			<aside class="players" aria-label="Players">
				<h2>At the table</h2>
				<ul>
					{#each conn.room.players as player (player.id)}
						<li class:offline={!player.connected}>
							<span class="dot" title={player.connected ? 'Online' : 'Offline'}></span>
							<span class="name">{player.name}{player.id === conn.playerId ? ' (you)' : ''}</span>
							<span class="role" data-role={player.role}>{ROLE_LABEL[player.role]}</span>
						</li>
					{/each}
				</ul>
			</aside>
		{:else}
			<p class="loading">{conn.error?.message ?? 'Connecting to the table…'}</p>
		{/if}

		{#if conn.status === 'closed' && conn.error}
			<div class="banner error" role="alert">
				{conn.error.message}
				<button type="button" onclick={() => location.reload()}>Reconnect</button>
			</div>
		{/if}
	</div>
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

	.room {
		position: fixed;
		inset: 0;
		overflow: hidden;
	}

	.stage {
		position: absolute;
		inset: 0;
	}

	.bar {
		position: absolute;
		top: 0.75rem;
		left: 0.75rem;
		right: 0.75rem;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		background: var(--panel);
		border: 1px solid var(--border);
		border-radius: 10px;
		backdrop-filter: blur(6px);
	}

	.brand {
		font-weight: 700;
		color: var(--text);
		text-decoration: none;
		margin-right: 0.25rem;
	}

	.code {
		font-family: ui-monospace, monospace;
		letter-spacing: 0.15em;
		padding: 0.2rem 0.5rem;
		border: 1px dashed var(--border);
		border-radius: 6px;
	}

	.views {
		display: flex;
		gap: 0.25rem;
		margin-left: auto;
	}

	.views [aria-pressed='true'] {
		border-color: var(--accent);
		color: var(--accent);
	}

	.status {
		font-size: 0.85rem;
		color: var(--muted);
	}

	.status[data-status='connected'] {
		color: var(--ok);
	}

	.status[data-status='reconnecting'],
	.status[data-status='closed'] {
		color: var(--danger);
	}

	.players {
		position: absolute;
		top: 5rem;
		right: 0.75rem;
		width: min(16rem, calc(100% - 1.5rem));
		padding: 0.75rem;
		background: var(--panel);
		border: 1px solid var(--border);
		border-radius: 10px;
		backdrop-filter: blur(6px);
	}

	.players h2 {
		margin: 0 0 0.5rem;
		font-size: 0.8rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--muted);
	}

	.players ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.35rem;
	}

	.players li {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.players li.offline {
		opacity: 0.5;
	}

	.dot {
		width: 0.55rem;
		height: 0.55rem;
		border-radius: 50%;
		background: var(--ok);
		flex: none;
	}

	.offline .dot {
		background: var(--muted);
	}

	.name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.role {
		font-size: 0.75rem;
		padding: 0.1rem 0.4rem;
		border-radius: 4px;
		border: 1px solid var(--border);
		color: var(--muted);
	}

	.role[data-role='gm'] {
		border-color: var(--accent);
		color: var(--accent);
	}

	.loading {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		margin: 0;
		color: var(--muted);
	}

	.banner {
		position: absolute;
		bottom: 1rem;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		gap: 0.75rem;
		align-items: center;
		padding: 0.6rem 0.9rem;
		background: var(--panel-solid);
		border: 1px solid var(--danger);
		border-radius: 8px;
		max-width: calc(100% - 2rem);
	}
</style>
