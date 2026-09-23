<script lang="ts">
	import { resolve } from '$app/paths';
	import { gridDistance, type GridPos } from '$lib/game/grid';
	import { canMoveToken } from '$lib/game/permissions';
	import type { Role } from '$lib/game/protocol';
	import { tokenAt } from '$lib/game/token';
	import type { RoomConnection } from '$lib/net/room-connection.svelte';
	import Tabletop from '$lib/tabletop/Tabletop.svelte';
	import type { CameraView, HighlightKind } from '$lib/tabletop/renderer';
	import type { ChatMessage } from '$lib/game/chat';
	import { formatBreakdown } from '$lib/game/dice';
	import ChatPanel from './ChatPanel.svelte';
	import TokenPanel, { type TokenDraft } from './TokenPanel.svelte';

	let { conn }: { conn: RoomConnection } = $props();

	// Local UI state only. Shared state lives in conn.room and changes only via server broadcasts.
	let view = $state<CameraView>('tactical');
	let selectedId = $state<string | null>(null);
	let placing = $state<TokenDraft | null>(null);
	let hoverCell = $state<GridPos | null>(null);
	let copied = $state(false);
	let toast = $state<string | null>(null);
	let rollCard = $state<Extract<ChatMessage, { kind: 'roll' }> | null>(null);
	// Only rolls that arrive while we're here pop up; history in the snapshot does not.
	let lastAnnouncedSeq: number | null = null;

	const room = $derived(conn.room);
	const me = $derived(conn.me);
	const isGm = $derived(me?.role === 'gm');
	const canMove = (tokenId: string | null) => {
		const token = tokenId && room?.tokens.find((t) => t.id === tokenId);
		return !!(token && me && canMoveToken(me, token));
	};
	// Selection drops by itself if the token is deleted or reassigned away from us.
	const selected = $derived(
		selectedId && canMove(selectedId)
			? (room?.tokens.find((t) => t.id === selectedId) ?? null)
			: null
	);
	const occupant = $derived(hoverCell && room ? tokenAt(room.tokens, hoverCell) : undefined);

	const highlight = $derived.by((): { cell: GridPos; kind: HighlightKind } | null => {
		if (!hoverCell) return null;
		if (placing) return { cell: hoverCell, kind: occupant ? 'blocked' : 'place' };
		if (selected) {
			const blocked = occupant && occupant.id !== selected.id;
			return { cell: hoverCell, kind: blocked ? 'blocked' : 'move' };
		}
		return null;
	});

	const hint = $derived.by(() => {
		if (placing) return `Click an empty cell to place ${placing.name}. Esc to cancel.`;
		if (selected) {
			const distance = hoverCell ? gridDistance(selected.pos, hoverCell) : null;
			const suffix = distance ? ` · ${distance} ${distance === 1 ? 'cell' : 'cells'}` : '';
			return `Moving ${selected.name}: click a cell${suffix}. Esc to deselect.`;
		}
		if (me?.role === 'spectator') return 'You are watching this table.';
		if (!isGm && room && !room.tokens.some((t) => t.ownerId === me?.id)) {
			return 'Waiting for the GM to give you a token.';
		}
		return isGm
			? 'Click any token to move it, or add one from the Tokens panel.'
			: 'Click one of your tokens to move it.';
	});

	function showToast(message: string) {
		toast = message;
	}

	$effect(() => {
		const err = conn.actionError;
		if (err) showToast(err.message);
	});

	$effect(() => {
		if (!room) return;
		const latest = room.log.at(-1);
		if (lastAnnouncedSeq === null) {
			lastAnnouncedSeq = latest?.seq ?? 0;
			return;
		}
		if (!latest || latest.seq <= lastAnnouncedSeq) return;
		lastAnnouncedSeq = latest.seq;
		if (latest.kind === 'roll') rollCard = latest;
	});

	$effect(() => {
		if (!rollCard) return;
		const timer = setTimeout(() => (rollCard = null), 4000);
		return () => clearTimeout(timer);
	});

	$effect(() => {
		if (!toast) return;
		const timer = setTimeout(() => (toast = null), 3500);
		return () => clearTimeout(timer);
	});

	function onTokenClick(id: string) {
		if (placing) return;
		if (canMove(id)) {
			selectedId = selectedId === id ? null : id;
			return;
		}
		const token = room?.tokens.find((t) => t.id === id);
		if (token) showToast(`${token.name} isn't yours to move.`);
	}

	function onCellClick(cell: GridPos) {
		if (placing) {
			if (tokenAt(room?.tokens ?? [], cell)) return showToast('That cell is taken.');
			conn.send({ type: 'token_create', ...placing, pos: cell });
			placing = null;
			return;
		}
		if (!selected) return;
		if (selected.pos.x === cell.x && selected.pos.y === cell.y) return;
		conn.send({ type: 'token_move', tokenId: selected.id, to: cell });
	}

	function onKeydown(event: KeyboardEvent) {
		if (event.key !== 'Escape') return;
		placing = null;
		selectedId = null;
	}

	async function copyInvite() {
		try {
			await navigator.clipboard.writeText(location.href);
			copied = true;
			setTimeout(() => (copied = false), 1500);
		} catch (err) {
			console.warn('[room] clipboard unavailable', err);
			showToast('Copy failed. Share the address bar link instead.');
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

<svelte:window onkeydown={onKeydown} />

<div class="room">
	{#if room}
		<div class="stage">
			<Tabletop
				grid={room.grid}
				tokens={room.tokens}
				selectedId={selected?.id ?? null}
				{highlight}
				{view}
				{onTokenClick}
				{onCellClick}
				onHover={(cell) => (hoverCell = cell)}
			/>
		</div>
	{/if}

	<header class="bar">
		<a class="brand" href={resolve('/')}>thirdfold</a>
		<span class="code" title="Room code">{room?.id}</span>
		<button type="button" onclick={copyInvite}>{copied ? 'Link copied' : 'Copy invite link'}</button
		>
		<div class="views" role="group" aria-label="Camera">
			<button type="button" aria-pressed={view === 'tactical'} onclick={() => (view = 'tactical')}>
				Tactical
			</button>
			<button type="button" aria-pressed={view === 'tabletop'} onclick={() => (view = 'tabletop')}>
				Tabletop
			</button>
		</div>
		<span class="status" data-status={conn.status}>{STATUS_LABEL[conn.status]}</span>
	</header>

	{#if room && me}
		<aside class="side">
			<section class="panel" aria-label="Players">
				<h2>At the table</h2>
				<ul class="players">
					{#each room.players as player (player.id)}
						<li class:offline={!player.connected}>
							<span class="dot" title={player.connected ? 'Online' : 'Offline'}></span>
							<span class="name">{player.name}{player.id === me.id ? ' (you)' : ''}</span>
							<span class="role" data-role={player.role}>{ROLE_LABEL[player.role]}</span>
						</li>
					{/each}
				</ul>
			</section>

			{#if me.role !== 'spectator'}
				<div class="panel">
					<TokenPanel
						{isGm}
						tokens={room.tokens}
						players={room.players}
						myId={me.id}
						{selected}
						{placing}
						onSelect={(id) => {
							placing = null;
							selectedId = id;
						}}
						onPlace={(draft) => {
							selectedId = null;
							placing = draft;
						}}
						send={(action) => conn.send(action)}
					/>
				</div>
			{/if}
		</aside>

		<section class="chat-dock panel">
			<ChatPanel
				log={room.log}
				myId={me.id}
				send={(action) => conn.send(action)}
				onError={showToast}
			/>
		</section>

		<p class="hint" aria-live="polite">{hint}</p>

		{#if rollCard}
			{#key rollCard.seq}
				<div class="roll-card" role="status">
					<span class="who">{rollCard.authorName} rolled {rollCard.roll.expression}</span>
					<span class="big">{rollCard.roll.total}</span>
					<span class="how">{formatBreakdown(rollCard.roll)}</span>
				</div>
			{/key}
		{/if}
	{:else}
		<p class="loading">{conn.error?.message ?? 'Connecting to the table…'}</p>
	{/if}

	{#if toast}
		<div class="toast" role="status">{toast}</div>
	{/if}

	{#if conn.status === 'closed' && conn.error}
		<div class="banner error" role="alert">
			{conn.error.message}
			<button type="button" onclick={() => location.reload()}>Reconnect</button>
		</div>
	{/if}
</div>

<style>
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

	.side {
		position: absolute;
		top: 5rem;
		right: 0.75rem;
		bottom: 4rem;
		width: min(17rem, calc(100% - 1.5rem));
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		overflow-y: auto;
		pointer-events: none;
	}

	.panel {
		pointer-events: auto;
		padding: 0.75rem;
		background: var(--panel);
		border: 1px solid var(--border);
		border-radius: 10px;
		backdrop-filter: blur(6px);
	}

	.panel h2 {
		margin: 0 0 0.5rem;
		font-size: 0.8rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--muted);
	}

	.players {
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

	.chat-dock {
		position: absolute;
		left: 0.75rem;
		bottom: 0.75rem;
		width: min(21rem, calc(100% - 1.5rem));
		height: min(24rem, 42vh);
		display: flex;
		flex-direction: column;
	}

	.roll-card {
		position: absolute;
		top: 32%;
		left: 50%;
		transform: translate(-50%, -50%);
		display: grid;
		justify-items: center;
		gap: 0.2rem;
		padding: 0.9rem 1.6rem;
		background: var(--panel-solid);
		border: 1px solid var(--accent);
		border-radius: 14px;
		box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
		pointer-events: none;
		animation: pop 260ms cubic-bezier(0.2, 1.4, 0.4, 1);
	}

	.roll-card .who {
		color: var(--muted);
		font-size: 0.9rem;
	}

	.roll-card .big {
		font-size: 3rem;
		font-weight: 800;
		line-height: 1;
		color: var(--accent);
	}

	.roll-card .how {
		font-family: ui-monospace, monospace;
		font-size: 0.85rem;
		color: var(--muted);
	}

	@keyframes pop {
		from {
			transform: translate(-50%, -50%) scale(0.6);
			opacity: 0;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.roll-card {
			animation: none;
		}
	}

	.hint {
		position: absolute;
		left: 50%;
		bottom: 1rem;
		transform: translateX(-50%);
		margin: 0;
		padding: 0.45rem 0.8rem;
		max-width: calc(100% - 2rem);
		background: var(--panel);
		border: 1px solid var(--border);
		border-radius: 999px;
		color: var(--muted);
		font-size: 0.9rem;
		pointer-events: none;
	}

	.toast {
		position: absolute;
		left: 50%;
		bottom: 3.75rem;
		transform: translateX(-50%);
		padding: 0.5rem 0.9rem;
		max-width: calc(100% - 2rem);
		background: var(--panel-solid);
		border: 1px solid var(--danger);
		border-radius: 8px;
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
