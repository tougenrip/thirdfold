<script lang="ts">
	import { resolve } from '$app/paths';
	import { canReach, inActionRange } from '$lib/adventure/adventure';
	import { actionOf, CHARACTERS, type CharacterId } from '$lib/adventure/characters';
	import type { ChatMessage } from '$lib/game/chat';
	import { formatBreakdown } from '$lib/game/dice';
	import { gridDistance, type GridPos } from '$lib/game/grid';
	import {
		alignToAxis,
		objectOnEdge,
		walkDistance,
		segmentProblem,
		type Door,
		type SceneObject
	} from '$lib/game/objects';
	import { canMoveToken, canUseDoor } from '$lib/game/permissions';
	import type { Role } from '$lib/game/protocol';
	import { tokenAt } from '$lib/game/token';
	import type { RoomConnection } from '$lib/net/room-connection.svelte';
	import Tabletop, { type FloatText } from '$lib/tabletop/Tabletop.svelte';
	import type { DiceThrow } from '$lib/tabletop/dice3d';
	import { diceToThrow } from '$lib/tabletop/dice-throw';
	import type { CameraView, HighlightKind, Pick, PreviewItem } from '$lib/tabletop/renderer';
	import { DEFAULT_LIGHT_RADIUS, LIGHT_COLORS, type Light } from '$lib/game/lights';
	import {
		footprintCells,
		footprintSize,
		obstaclesFor,
		placementProblem,
		propAt,
		type Prop,
		type Rotation
	} from '$lib/game/props';
	import ActionBar from './ActionBar.svelte';
	import AdventurePanel from './AdventurePanel.svelte';
	import Decision from './Decision.svelte';
	import BuildPanel, { type BuildTool, type LightDraft, type PropDraft } from './BuildPanel.svelte';
	import CharacterSelect from './CharacterSelect.svelte';
	import CharacterSheet from './CharacterSheet.svelte';
	import SectionEnd from './SectionEnd.svelte';
	import PropInspector from './PropInspector.svelte';
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
	let propDraft = $state<PropDraft>({ assetId: 'table', rotation: 0 });
	let selectedPropId = $state<string | null>(null);
	let copied = $state(false);
	let toast = $state<string | null>(null);
	let rollCard = $state<RollEntry | null>(null);
	/** The roll being thrown as 3D dice; its card shows once they land. */
	let diceThrow = $state<DiceThrow | null>(null);
	let pendingCard: RollEntry | null = null;
	/** The end-of-section screen the viewer closed to look around (by stage and time). */
	let dismissedEnd = $state<string | null>(null);
	/** An action of my character waiting for a target. */
	let targeting = $state<string | null>(null);
	let sheetOpen = $state(false);
	/** The character just taken, to introduce. */
	let introFor = $state<CharacterId | null>(null);
	/** My character as last seen; undefined until the room has loaded. */
	let knownCharacter: CharacterId | null | undefined = undefined;
	let floats = $state<FloatText[]>([]);
	let floatSeq = 0;
	let cardTimer: ReturnType<typeof setTimeout> | undefined;
	// Only rolls that arrive while we're here pop up; history in the snapshot does not.
	let lastAnnouncedSeq: number | null = null;

	type RollEntry = Extract<ChatMessage, { kind: 'roll' | 'attack' | 'ability' | 'check' }>;

	const room = $derived(conn.room);
	const me = $derived(conn.me);
	const isGm = $derived(me?.role === 'gm');
	const adventure = $derived(room?.adventure ?? null);
	const myCharacter = $derived(
		(me && adventure?.characters.find((c) => c.inPlay && c.playerId === me.id)) || null
	);
	const myCharacterToken = $derived(
		(myCharacter && room?.tokens.find((t) => t.id === myCharacter.tokenId)) || null
	);
	/** Cells my character may still move this round, while a fight is on and it is selected. */
	const movesLeft = $derived.by(() => {
		const encounter = adventure?.encounter;
		if (!encounter || !myCharacter || selectedId !== myCharacter.tokenId) return null;
		return Math.max(0, CHARACTERS[myCharacter.id].speed - (encounter.moved[myCharacter.id] ?? 0));
	});
	/** Fallen characters' tokens, drawn lying down. */
	const fallen = $derived(
		(adventure?.characters ?? []).flatMap((c) =>
			c.tokenId && (c.downed || c.dead) ? [c.tokenId] : []
		)
	);
	const endKey = $derived(
		adventure && (adventure.stage === 'complete' || adventure.stage === 'defeat')
			? `${adventure.stage}:${adventure.completedAt ?? adventure.begunAt}`
			: null
	);
	const hoverCell = $derived(hover?.cell ?? null);
	const blocked = $derived(
		room ? obstaclesFor(room.grid, room.objects, room.props) : new Set<string>()
	);
	const selectedProp = $derived(
		(isGm && selectedPropId && room?.props.find((p) => p.id === selectedPropId)) || null
	);
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

	/** A prop under the pointer, or covering the pointed-at cell. */
	function propUnder(pick: Pick | null): Prop | undefined {
		if (!pick || !room) return undefined;
		if (pick.propId) return room.props.find((p) => p.id === pick.propId);
		return pick.cell ? propAt(room.props, pick.cell) : undefined;
	}

	/** A prop's footprint as a preview rectangle, green where it may stand and red where not. */
	function footprintPreview(placement: Omit<Prop, 'id' | 'scale'>, selfId?: string): PreviewItem[] {
		if (!room) return [];
		const { w, h } = footprintSize(placement.assetId, placement.rotation);
		const problem = placementProblem(room.grid, placement, room.tokens, room.props, selfId);
		return [
			{
				kind: 'area',
				from: placement.pos,
				to: { x: placement.pos.x + w - 1, y: placement.pos.y + h - 1 },
				tone: problem ? 'invalid' : 'valid'
			}
		];
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
		if (tool === 'prop' && hover.cell) return footprintPreview({ ...propDraft, pos: hover.cell });
		if (tool === 'select' && selectedProp && hover.cell && hover.propId !== selectedProp.id) {
			return footprintPreview({ ...selectedProp, pos: hover.cell }, selectedProp.id);
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

	type AdventureTarget =
		| { kind: 'interact'; id: string; verb: string; name: string; inReach: boolean }
		| { kind: 'act'; actionId: string; id: string; name: string; inReach: boolean };

	/**
	 * What clicking a pick would make my character do, if anything: the action
	 * being aimed, else the basic attack on an enemy, else talking to or
	 * examining something.
	 */
	function adventureTarget(pick: Pick | null): AdventureTarget | null {
		if (!pick || !room || !adventure || !myCharacter || !myCharacterToken || isGm) return null;
		if (myCharacter.downed || myCharacter.dead) return null;
		const def = CHARACTERS[myCharacter.id];
		const token = pick.tokenId ? room.tokens.find((t) => t.id === pick.tokenId) : undefined;
		const enemy = token && adventure.encounter?.enemies.find((e) => e.tokenId === token.id);
		const ally = token && adventure.characters.find((c) => c.tokenId === token.id && !c.dead);
		const aimed = targeting ? actionOf(def, targeting) : undefined;
		if (aimed && token && (aimed.target === 'enemy' ? enemy : ally)) {
			const name = `${aimed.name} on ${enemy ? `the ${token.name}` : token.name}`;
			const inReach = inActionRange(blocked, myCharacterToken.pos, token.pos, aimed);
			return { kind: 'act', actionId: aimed.id, id: token.id, name, inReach };
		}
		if (token && enemy) {
			const basic = def.actions[0];
			const inReach = inActionRange(blocked, myCharacterToken.pos, token.pos, basic);
			const name = `${basic.name} on the ${token.name}`;
			return { kind: 'act', actionId: basic.id, id: token.id, name, inReach };
		}
		// Talking and searching wait until the fight is over (and until play has begun).
		if (adventure.encounter || adventure.stage === 'choosing') return null;
		const prop = !token && pick.propId ? room.props.find((p) => p.id === pick.propId) : undefined;
		const cells = token ? [token.pos] : prop ? footprintCells(prop) : [];
		const thing = adventure.interactables.find((i) =>
			i.cells.some((c) => cells.some((d) => d.x === c.x && d.y === c.y))
		);
		if (!thing) return null;
		const inReach = canReach(blocked, myCharacterToken.pos, thing.cells);
		const [verb] = thing.verbs;
		if (!verb) return null;
		return { kind: 'interact', id: thing.id, verb: verb.id, name: verb.label, inReach };
	}

	/** Floats what an attack or ability did over the tokens involved. */
	function floatResult(entry: RollEntry) {
		if (!room) return;
		const add = (tokenId: string | null | undefined, text: string, color: string) => {
			if (tokenId) floats = [...floats.slice(-19), { id: ++floatSeq, tokenId, text, color }];
		};
		if (entry.kind === 'attack') {
			if (!entry.hit) add(entry.targetId, 'Miss', '#b3a38a');
			else add(entry.targetId, `-${entry.damage?.total ?? 0}`, '#ff7b6b');
			if (entry.effect) add(entry.targetId, entry.effect, '#e0a458');
		} else if (entry.kind === 'ability') {
			if (entry.amount !== null && entry.amount !== 0) {
				const color = entry.amount > 0 ? '#7fc47a' : '#ff9a4d';
				add(entry.targetId, `${entry.amount > 0 ? '+' : ''}${entry.amount}`, color);
			} else if (!entry.targetId) {
				// A guard: over the one who raised it.
				const caster = room.tokens.find((t) => t.ownerId === entry.authorId);
				add(caster?.id, entry.ability, '#e0a458');
			}
		}
	}

	function showCard(entry: RollEntry) {
		rollCard = entry;
		floatResult(entry);
	}

	const hoveredPropId = $derived.by(() => {
		if (!isGm && hover?.propId && adventureTarget(hover)) return hover.propId;
		if (!isGm || placing) return null;
		if (tool === 'erase' && !objectUnder(hover) && !lightUnder(hover)) {
			return propUnder(hover)?.id ?? null;
		}
		if (tool === 'select' && !selected && !selectedProp && !hover?.tokenId && !doorUnder(hover)) {
			return propUnder(hover)?.id ?? null;
		}
		return null;
	});

	/** Steps for the selected token to walk to the hovered cell (null: no way there). */
	const steps = $derived(
		selected && hoverCell && room && !isGm
			? walkDistance(room.grid, blocked, selected.pos, hoverCell)
			: null
	);
	const reachable = $derived(
		!!selected &&
			!!hoverCell &&
			(isGm || (steps !== null && (movesLeft === null || steps <= movesLeft)))
	);

	const highlight = $derived.by((): { cell: GridPos; kind: HighlightKind } | null => {
		if (!hoverCell || tool !== 'select' || selectedProp) return null;
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
		if (tool === 'erase') return 'Erase: click a wall, door, light or prop to remove it.';
		if (tool === 'prop') {
			const problem =
				hover?.cell && room
					? placementProblem(room.grid, { ...propDraft, pos: hover.cell }, room.tokens, room.props)
					: null;
			return problem?.message ?? 'Prop: click to place. [ and ] rotate. Esc to stop.';
		}
		if (selectedProp) {
			return 'Click a cell to move the prop. [ and ] rotate, Delete removes, Esc deselects.';
		}
		if (hoveredPropId && isGm) return 'Click to select this prop.';
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
		const target = adventureTarget(hover);
		if (target) {
			if (!target.inReach) {
				return target.kind === 'act' ? 'Out of reach.' : 'Walk up to it to interact.';
			}
			return target.kind === 'act'
				? `Click: ${target.name}.`
				: `Click to ${target.name[0].toLowerCase()}${target.name.slice(1)}.`;
		}
		if (targeting) return 'Choose a target on the table or in the action bar. Esc to cancel.';
		if (selected) {
			const distance = hoverCell ? (steps ?? gridDistance(selected.pos, hoverCell)) : null;
			const suffix = distance ? ` · ${distance} ${distance === 1 ? 'cell' : 'cells'}` : '';
			const left = movesLeft === null ? '' : ` · ${movesLeft} left this round`;
			const way =
				hoverCell && !reachable ? (steps === null ? ' · no way through' : ' · too far') : '';
			return `Moving ${selected.name}: click a cell${suffix}${way}${left}.`;
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
		if (
			latest.kind !== 'roll' &&
			latest.kind !== 'attack' &&
			latest.kind !== 'ability' &&
			latest.kind !== 'check'
		) {
			return;
		}
		const dice =
			latest.kind === 'roll' || latest.kind === 'check'
				? diceToThrow(latest.roll)
				: latest.kind === 'attack'
					? [...diceToThrow(latest.toHit), ...(latest.damage ? diceToThrow(latest.damage) : [])]
					: latest.roll
						? diceToThrow(latest.roll)
						: [];
		if (dice.length === 0) {
			showCard(latest);
			return;
		}
		// Dice in the roller's token colour when they have one (an enemy rolls in its own).
		const color =
			room.tokens.find((t) => t.ownerId === latest.authorId || t.id === latest.authorId)?.color ??
			'#efe6d2';
		pendingCard = latest;
		diceThrow = { seq: latest.seq, dice, color };
	});

	function onDiceThrown(seq: number, ms: number) {
		const card = pendingCard;
		if (!card || card.seq !== seq) return;
		pendingCard = null;
		clearTimeout(cardTimer);
		cardTimer = setTimeout(() => showCard(card), ms);
	}

	$effect(() => () => clearTimeout(cardTimer));

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
		selectedPropId = null;
	}

	function rotateBy(rotation: Rotation, by: 1 | -1): Rotation {
		return ((rotation + by + 4) % 4) as Rotation;
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
				if (light) return void conn.send({ type: 'light_delete', lightId: light.id });
				const prop = propUnder(pick);
				if (prop) conn.send({ type: 'prop_delete', propId: prop.id });
				return;
			}
			case 'prop': {
				if (!pick.cell) return;
				const placement = { ...propDraft, pos: pick.cell };
				const problem = placementProblem(room.grid, placement, room.tokens, room.props);
				if (problem) return showToast(problem.message);
				conn.send({ type: 'prop_create', ...placement });
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
		if (selectedProp && !pick.tokenId) {
			// A selected prop moves to wherever the GM clicks; clicking it again lets go.
			if (pick.propId === selectedProp.id || !pick.cell) {
				selectedPropId = null;
				return;
			}
			const moved = { ...selectedProp, pos: pick.cell };
			const problem = placementProblem(room.grid, moved, room.tokens, room.props, selectedProp.id);
			if (problem) return showToast(problem.message);
			conn.send({ type: 'prop_update', propId: selectedProp.id, patch: { pos: pick.cell } });
			return;
		}
		const target = adventureTarget(pick);
		if (target) {
			if (!target.inReach) {
				return showToast(target.kind === 'act' ? 'Out of reach.' : 'Walk up to it first.');
			}
			conn.send(
				target.kind === 'act'
					? { type: 'adventure_act', actionId: target.actionId, targetId: target.id }
					: { type: 'adventure_interact', targetId: target.id, verb: target.verb }
			);
			targeting = null;
			return;
		}
		if (pick.tokenId) {
			selectedPropId = null;
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
		if (isGm && !selected) {
			const prop = propUnder(pick);
			if (prop) {
				selectedPropId = prop.id;
				return;
			}
		}
		if (!selected || !pick.cell) return;
		if (selected.pos.x === pick.cell.x && selected.pos.y === pick.cell.y) return;
		conn.send({ type: 'token_move', tokenId: selected.id, to: pick.cell });
	}

	function onKeydown(event: KeyboardEvent) {
		const typing = (event.target as HTMLElement | null)?.closest(
			'input, textarea, select, [contenteditable]'
		);
		if (isGm && !typing && (event.key === '[' || event.key === ']')) {
			const by = event.key === ']' ? 1 : -1;
			if (tool === 'prop') propDraft = { ...propDraft, rotation: rotateBy(propDraft.rotation, by) };
			else if (selectedProp) {
				const rotation = rotateBy(selectedProp.rotation, by);
				conn.send({ type: 'prop_update', propId: selectedProp.id, patch: { rotation } });
			}
			return;
		}
		if (isGm && !typing && selectedProp && (event.key === 'Delete' || event.key === 'Backspace')) {
			conn.send({ type: 'prop_delete', propId: selectedProp.id });
			selectedPropId = null;
			return;
		}
		if (event.key === 'Escape') {
			if (targeting) {
				targeting = null;
				return;
			}
			selectedPropId = null;
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
			p: 'prop',
			...(room?.fog.enabled ? { r: 'reveal', h: 'hide' } : {})
		};
		const next = shortcut[event.key.toLowerCase()];
		if (next) setTool(next);
	}

	// Introduce a character when this player takes it (not when a reload finds it already taken).
	$effect(() => {
		if (!room) return;
		const id = myCharacter?.id ?? null;
		if (knownCharacter !== undefined && id && id !== knownCharacter) introFor = id;
		knownCharacter = id;
	});

	// An aimed action is dropped when it can no longer be used.
	$effect(() => {
		const phase = adventure?.encounter?.phase;
		if (targeting && (!myCharacter || myCharacter.downed || phase === 'enemies')) targeting = null;
	});

	// In an adventure, a player's own character is always the one ready to move.
	$effect(() => {
		if (myCharacterToken && !selectedId && !placing && tool === 'select') {
			selectedId = myCharacterToken.id;
		}
	});

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
				props={room.props}
				{diceThrow}
				{onDiceThrown}
				selectedPropId={selectedProp?.id ?? null}
				{hoveredPropId}
				fogMode={isGm ? 'gm' : 'player'}
				{hoveredObjectId}
				{preview}
				selectedId={selected?.id ?? null}
				{fallen}
				{floats}
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

			{#if adventure || isGm}
				<div class="panel">
					<AdventurePanel
						{adventure}
						{isGm}
						players={room.players}
						send={(action) => conn.send(action)}
					/>
				</div>
			{/if}

			{#if selectedProp}
				<div class="panel">
					<PropInspector
						prop={selectedProp}
						send={(action) => conn.send(action)}
						onDone={() => (selectedPropId = null)}
					/>
				</div>
			{/if}

			{#if isGm}
				<div class="panel">
					<BuildPanel
						{tool}
						fogEnabled={room.fog.enabled}
						ambient={room.ambient}
						{lightDraft}
						{propDraft}
						onTool={setTool}
						onPropDraft={(draft) => (propDraft = draft)}
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

			<!-- In an adventure a player's character is handled by the action bar. -->
			{#if isGm || (me.role === 'player' && !adventure)}
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

		{#if adventure?.encounter}
			{@const encounter = adventure.encounter}
			<div class="encounter" role="status">
				<span class="round">Round {encounter.round}</span>
				<span class="phase">{encounter.phase === 'players' ? "Party's turn" : "Enemies' turn"}</span
				>
				{#each encounter.enemies as e (e.tokenId)}
					<span class="foe">
						{e.name}
						<span class="foe-hp"><span style:width={`${(100 * e.hp) / e.maxHp}%`}></span></span>
						{e.hp}/{e.maxHp}
					</span>
				{/each}
			</div>
		{/if}

		{#if adventure && myCharacter && myCharacterToken}
			<div class="action-dock">
				<ActionBar
					{adventure}
					character={myCharacter}
					token={myCharacterToken}
					tokens={room.tokens}
					{blocked}
					{targeting}
					onTargeting={(id) => (targeting = id)}
					onSheet={() => (sheetOpen = true)}
					send={(action) => conn.send(action)}
				/>
			</div>
		{/if}

		{#if myCharacter && (introFor === myCharacter.id || sheetOpen)}
			<CharacterSheet
				character={CHARACTERS[myCharacter.id]}
				status={myCharacter}
				intro={introFor === myCharacter.id}
				onClose={() => {
					introFor = null;
					sheetOpen = false;
				}}
			/>
		{/if}

		{#if rollCard}
			{#key rollCard.seq}
				<div class="roll-card" role="status">
					{#if rollCard.kind === 'roll'}
						<span class="who">{rollCard.authorName} rolled {rollCard.roll.expression}</span>
						<span class="big">{rollCard.roll.total}</span>
						<span class="how">{formatBreakdown(rollCard.roll)}</span>
					{:else if rollCard.kind === 'check'}
						<span class="who">{rollCard.authorName} · {rollCard.action}</span>
						<span class="big" class:miss={!rollCard.success}>{rollCard.roll.total}</span>
						<span class="how">
							{rollCard.stat} check vs {rollCard.dc} · {rollCard.success ? 'found' : 'nothing'}
						</span>
					{:else if rollCard.kind === 'ability'}
						<span class="who">
							{rollCard.authorName} · {rollCard.ability}{rollCard.targetName
								? ` → ${rollCard.targetName}`
								: ''}
						</span>
						{#if rollCard.amount !== null}
							<span class="big" class:heal={rollCard.amount > 0}>
								{rollCard.amount > 0 ? '+' : ''}{rollCard.amount}
							</span>
						{/if}
						<span class="how">{rollCard.text}</span>
					{:else}
						<span class="who"
							>{rollCard.authorName} · {rollCard.attack} → {rollCard.targetName}</span
						>
						<span class="big" class:miss={!rollCard.hit}>
							{rollCard.hit ? `${rollCard.damage?.total ?? 0}` : 'Miss'}
						</span>
						<span class="how">
							{rollCard.toHit.total} vs {rollCard.defense}{rollCard.hit ? ' · hit, damage' : ''}
						</span>
						{#if rollCard.effect}<span class="outcome">{rollCard.effect}</span>{/if}
						{#if rollCard.outcome}<span class="outcome">{rollCard.outcome}</span>{/if}
					{/if}
				</div>
			{/key}
		{/if}

		{#if adventure?.decision && !adventure.encounter}
			<Decision
				decision={adventure.decision}
				canAnswer={isGm || (!!myCharacter && !myCharacter.downed && !myCharacter.dead)}
				send={(action) => conn.send(action)}
			/>
		{/if}

		{#if adventure && me.role === 'player' && !myCharacter && adventure.stage !== 'complete' && adventure.stage !== 'defeat'}
			<CharacterSelect {adventure} players={room.players} send={(action) => conn.send(action)} />
		{/if}

		{#if adventure && endKey && dismissedEnd !== endKey}
			<SectionEnd
				{adventure}
				players={room.players}
				{isGm}
				send={(action) => conn.send(action)}
				onClose={() => (dismissedEnd = endKey)}
			/>
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
		top: 5.25rem;
		z-index: 2;
		transform: translateX(-50%);
		padding: 0.5rem 0.9rem;
		max-width: calc(100% - 2rem);
		background: var(--panel-solid);
		border: 1px solid var(--danger);
		border-radius: 8px;
	}

	.encounter {
		position: absolute;
		top: 5rem;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.75rem;
		padding: 0.4rem 0.9rem;
		max-width: calc(100% - 2rem);
		background: var(--panel-solid);
		border: 1px solid var(--danger);
		border-radius: 999px;
		font-size: 0.9rem;
		pointer-events: none;
	}

	.encounter .round {
		font-weight: 700;
		color: var(--danger);
	}

	.encounter .phase {
		color: var(--muted);
	}

	.foe {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		font-variant-numeric: tabular-nums;
	}

	.foe-hp {
		width: 4.5rem;
		height: 0.5rem;
		border-radius: 999px;
		background: #120e0b;
		border: 1px solid var(--border);
		overflow: hidden;
	}

	.foe-hp span {
		display: block;
		height: 100%;
		background: var(--danger);
		transition: width 300ms ease;
	}

	.action-dock {
		position: absolute;
		left: 50%;
		bottom: 3.4rem;
		transform: translateX(-50%);
		max-width: calc(100% - 2rem);
	}

	.roll-card .big.miss {
		color: var(--muted);
		font-size: 2.2rem;
	}

	.roll-card .big.heal {
		color: var(--ok);
	}

	.roll-card .outcome {
		font-weight: 700;
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
