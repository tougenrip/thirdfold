<script lang="ts">
	import { resolve } from '$app/paths';
	import type { ChatMessage } from '$lib/game/chat';
	import { formatBreakdown } from '$lib/game/dice';
	import { gridDistance, type GridPos } from '$lib/game/grid';
	import {
		alignToAxis,
		blockingEdges,
		isReachable,
		objectOnEdge,
		segmentProblem,
		type Door,
		type SceneObject
	} from '$lib/game/objects';
	import { canMoveToken, canUseDoor } from '$lib/game/permissions';
	import type { Role } from '$lib/game/protocol';
	import { tokenAt } from '$lib/game/token';
	import type { RoomConnection } from '$lib/net/room-connection.svelte';
	import Tabletop from '$lib/tabletop/Tabletop.svelte';
	import type { CameraView, HighlightKind, Pick, PreviewItem } from '$lib/tabletop/renderer';
	import { DEFAULT_LIGHT_RADIUS, LIGHT_COLORS, type Light } from '$lib/game/lights';
	import BuildPanel, { type BuildTool, type LightDraft } from './BuildPanel.svelte';
	import ChatPanel from './ChatPanel.svelte';
	import ScenePanel from './ScenePanel.svelte';
	import TokenPanel, { type TokenDraft } from './TokenPanel.svelte';

	let { conn }: { conn: RoomConnection } = $props();

	/** How close (in cells) the pointer must be to a grid line to target the wall or door on it. */
	const EDGE_REACH = 0.22;

	// Local UI state only. Shared state lives in conn.room and changes only via server broadcasts.
	let view = $state<CameraView>('tactical');
	let tool = $state<BuildTool>('select');
	let selectedId = $state<string | null>(null);
	let placing = $state<TokenDraft | null>(null);
	let hover = $state<Pick | null>(null);
	/** First corner of the wall being drawn. */
	let wallStart = $state<GridPos | null>(null);
	/** First cell of the area being revealed or hidden. */
	let areaStart = $state<GridPos | null>(null);
	let lightDraft = $state<LightDraft>({
		radius: DEFAULT_LIGHT_RADIUS,
		color: LIGHT_COLORS[0].color
	});
	let copied = $state(false);
	let toast = $state<string | null>(null);
	let rollCard = $state<Extract<ChatMessage, { kind: 'roll' }> | null>(null);
	// Only rolls that arrive while we're here pop up; history in the snapshot does not.
	let lastAnnouncedSeq: number | null = null;

	const room = $derived(conn.room);
	const me = $derived(conn.me);
	const isGm = $derived(me?.role === 'gm');
	const hoverCell = $derived(hover?.cell ?? null);
	const blocked = $derived(blockingEdges(room?.objects ?? []));
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

	/** The wall or door the pointer targets: one it is over in 3D, else one on the grid line it is near. */
	function objectUnder(pick: Pick | null): SceneObject | undefined {
		if (!pick || !room) return undefined;
		if (pick.objectId) return room.objects.find((o) => o.id === pick.objectId);
		if (pick.edge && pick.edgeDistance <= EDGE_REACH) return objectOnEdge(room.objects, pick.edge);
		return undefined;
	}
	/** A light fixture under the pointer, or standing on the pointed-at cell. */
	function lightUnder(pick: Pick | null): Light | undefined {
		if (!pick || !room) return undefined;
		if (pick.lightId) return room.lights.find((l) => l.id === pick.lightId);
		const cell = pick.cell;
		return cell ? room.lights.find((l) => l.pos.x === cell.x && l.pos.y === cell.y) : undefined;
	}

	const doorUnder = (pick: Pick | null): Door | undefined => {
		const o = objectUnder(pick);
		return o?.kind === 'door' ? o : undefined;
	};

	/** The far end of the wall being drawn, snapped onto a row or column through its start. */
	const wallEnd = $derived(
		wallStart && hover?.corner ? alignToAxis(wallStart, hover.corner) : null
	);
	const wallProblem = $derived(
		room && wallStart && wallEnd ? segmentProblem(room.grid, wallStart, wallEnd) : null
	);

	const preview = $derived.by((): PreviewItem[] => {
		if (!hover || placing) return [];
		if (tool === 'wall') {
			if (!wallStart) return hover.corner ? [{ kind: 'corner', at: hover.corner }] : [];
			const items: PreviewItem[] = [{ kind: 'corner', at: wallStart }];
			if (wallEnd && (wallEnd.x !== wallStart.x || wallEnd.y !== wallStart.y)) {
				items.push({
					kind: 'segment',
					a: wallStart,
					b: wallEnd,
					tone: wallProblem ? 'invalid' : 'valid'
				});
			}
			return items;
		}
		if ((tool === 'reveal' || tool === 'hide') && hover.cell) {
			return [{ kind: 'area', from: areaStart ?? hover.cell, to: hover.cell, tone: tool }];
		}
		if (tool === 'door' && hover.edge) {
			const existing = room && objectOnEdge(room.objects, hover.edge);
			return [
				{ kind: 'segment', ...hover.edge, tone: existing?.kind === 'door' ? 'invalid' : 'door' }
			];
		}
		return [];
	});

	const hoveredObjectId = $derived.by(() => {
		if (placing) return null;
		if (tool === 'erase') return objectUnder(hover)?.id ?? null;
		if (tool === 'select' && !hover?.tokenId) return doorUnder(hover)?.id ?? null;
		return null;
	});

	const reachable = $derived(
		!!(
			selected &&
			hoverCell &&
			room &&
			(isGm || isReachable(room.grid, blocked, selected.pos, hoverCell))
		)
	);

	const highlight = $derived.by((): { cell: GridPos; kind: HighlightKind } | null => {
		if (!hoverCell || tool !== 'select') return null;
		if (placing) return { cell: hoverCell, kind: occupant ? 'blocked' : 'place' };
		if (selected && !doorUnder(hover)) {
			const taken = occupant && occupant.id !== selected.id;
			return { cell: hoverCell, kind: taken || !reachable ? 'blocked' : 'move' };
		}
		return null;
	});

	const hint = $derived.by(() => {
		if (placing) return `Click an empty cell to place ${placing.name}. Esc to cancel.`;
		if (tool === 'wall') {
			if (!wallStart) return 'Wall: click a grid corner to start.';
			return (
				wallProblem ?? 'Click another corner to finish this wall and start the next. Esc to stop.'
			);
		}
		if (tool === 'door') return 'Door: click a grid line. Placing a door in a wall cuts a doorway.';
		if (tool === 'erase') return 'Erase: click a wall, door or light to remove it.';
		if (tool === 'light') {
			const existing = lightUnder(hover);
			return existing
				? `Click to switch this light ${existing.on ? 'off' : 'on'}.`
				: 'Light: click a cell to place a light there. Click a light to switch it on or off.';
		}
		if (tool === 'reveal' || tool === 'hide') {
			const verb = tool === 'reveal' ? 'reveal to' : 'hide from';
			return areaStart
				? `Click the opposite corner cell to ${verb} the players. Esc to cancel.`
				: `${tool === 'reveal' ? 'Reveal' : 'Hide'}: click a cell to start an area.`;
		}
		if (hoveredObjectId && doorUnder(hover)) {
			const door = doorUnder(hover)!;
			return `Click to ${door.open ? 'close' : 'open'} the door.`;
		}
		if (selected) {
			const distance = hoverCell ? gridDistance(selected.pos, hoverCell) : null;
			const suffix = distance ? ` · ${distance} ${distance === 1 ? 'cell' : 'cells'}` : '';
			const way = hoverCell && !reachable ? ' · no way through' : '';
			return `Moving ${selected.name}: click a cell${suffix}${way}. Esc to deselect.`;
		}
		if (me?.role === 'spectator') return 'You are watching this table.';
		if (!isGm && room?.fog.enabled && !room.tokens.some((t) => t.ownerId === me?.id)) {
			return 'Fog of war is on. You see what the GM reveals.';
		}
		if (!isGm && room && !room.tokens.some((t) => t.ownerId === me?.id)) {
			return 'Waiting for the GM to give you a token.';
		}
		return isGm
			? 'Click any token to move it, or build with the tools in the side panel.'
			: 'Click one of your tokens to move it, or a door next to it to open it.';
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

	function setTool(next: BuildTool) {
		tool = next;
		wallStart = null;
		areaStart = null;
		placing = null;
		selectedId = null;
	}

	function onClick(pick: Pick) {
		if (!room || !me) return;
		if (placing) {
			if (!pick.cell) return;
			if (tokenAt(room.tokens, pick.cell)) return showToast('That cell is taken.');
			conn.send({ type: 'token_create', ...placing, pos: pick.cell });
			placing = null;
			return;
		}
		switch (tool) {
			case 'wall':
				return clickWall(pick);
			case 'door':
				if (pick.edge) conn.send({ type: 'object_create', kind: 'door', ...pick.edge });
				return;
			case 'reveal':
			case 'hide': {
				if (!pick.cell) return;
				if (!areaStart) {
					areaStart = pick.cell;
					return;
				}
				conn.send({ type: 'fog_area', from: areaStart, to: pick.cell, reveal: tool === 'reveal' });
				areaStart = null;
				return;
			}
			case 'erase': {
				const target = objectUnder(pick);
				if (target) return void conn.send({ type: 'object_delete', objectId: target.id });
				const light = lightUnder(pick);
				if (light) conn.send({ type: 'light_delete', lightId: light.id });
				return;
			}
			case 'light': {
				const existing = lightUnder(pick);
				if (existing) {
					conn.send({ type: 'light_update', lightId: existing.id, patch: { on: !existing.on } });
				} else if (pick.cell) {
					conn.send({ type: 'light_create', pos: pick.cell, ...lightDraft });
				}
				return;
			}
			case 'select':
				return clickSelect(pick);
		}
	}

	function clickWall(pick: Pick) {
		if (!pick.corner) return;
		if (!wallStart) {
			wallStart = pick.corner;
			return;
		}
		const end = alignToAxis(wallStart, pick.corner);
		if (end.x === wallStart.x && end.y === wallStart.y) {
			wallStart = null;
			return;
		}
		if (wallProblem) return showToast(wallProblem);
		conn.send({ type: 'object_create', kind: 'wall', a: wallStart, b: end });
		wallStart = end; // keep drawing from here
	}

	function clickSelect(pick: Pick) {
		if (!room || !me) return;
		if (pick.tokenId) {
			const id = pick.tokenId;
			if (canMove(id)) {
				selectedId = selectedId === id ? null : id;
				return;
			}
			const token = room.tokens.find((t) => t.id === id);
			if (token) showToast(`${token.name} isn't yours to move.`);
			return;
		}
		const door = doorUnder(pick);
		if (door) {
			if (!canUseDoor(me, door, room.tokens, room.grid)) {
				return showToast(
					me.role === 'player'
						? 'Move one of your tokens next to the door first.'
						: 'Spectators cannot open doors.'
				);
			}
			conn.send({ type: 'door_toggle', objectId: door.id });
			return;
		}
		if (!selected || !pick.cell) return;
		if (selected.pos.x === pick.cell.x && selected.pos.y === pick.cell.y) return;
		conn.send({ type: 'token_move', tokenId: selected.id, to: pick.cell });
	}

	function onKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			if (wallStart || areaStart) {
				wallStart = null;
				areaStart = null;
			} else if (tool !== 'select') tool = 'select';
			placing = null;
			selectedId = null;
			return;
		}
		// Tool shortcuts, but never while typing.
		const target = event.target as HTMLElement | null;
		if (!isGm || event.ctrlKey || event.metaKey || event.altKey) return;
		if (target?.closest('input, textarea, select, [contenteditable]')) return;
		const shortcut: Record<string, BuildTool> = {
			v: 'select',
			w: 'wall',
			d: 'door',
			e: 'erase',
			l: 'light',
			...(room?.fog.enabled ? { r: 'reveal', h: 'hide' } : {})
		};
		const next = shortcut[event.key.toLowerCase()];
		if (next) setTool(next);
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
				objects={room.objects}
				fog={room.fog}
				ambient={room.ambient}
				lights={room.lights}
				fogMode={isGm ? 'gm' : 'player'}
				{hoveredObjectId}
				{preview}
				selectedId={selected?.id ?? null}
				{highlight}
				{view}
				{onClick}
				onHover={(pick) => (hover = pick)}
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

			{#if isGm}
				<div class="panel">
					<BuildPanel
						{tool}
						fogEnabled={room.fog.enabled}
						ambient={room.ambient}
						{lightDraft}
						onTool={setTool}
						onAmbient={(ambient) => conn.send({ type: 'ambient_set', ambient })}
						onLightDraft={(draft) => (lightDraft = draft)}
						onFog={(enabled) => {
							if (!enabled && (tool === 'reveal' || tool === 'hide')) setTool('select');
							conn.send({ type: 'fog_set', enabled });
						}}
						onFogAll={(reveal) =>
							conn.send({
								type: 'fog_area',
								from: { x: 0, y: 0 },
								to: { x: room.grid.width - 1, y: room.grid.height - 1 },
								reveal
							})}
					/>
				</div>
			{/if}

			{#if isGm}
				<div class="panel">
					<ScenePanel
						sceneName={room.sceneName}
						reply={conn.sceneReply}
						send={(action) => conn.send(action)}
						onError={showToast}
					/>
				</div>
			{/if}

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
							tool = 'select';
							selectedId = id;
						}}
						onPlace={(draft) => {
							selectedId = null;
							tool = 'select';
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
