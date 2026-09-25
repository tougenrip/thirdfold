<script lang="ts">
	import { asset, resolve } from '$app/paths';
	import { canReach, inActionRange } from '$lib/adventure/adventure';
	import { actionOf, type CharacterId } from '$lib/adventure/characters';
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
	import { roomAround, roomBoundary } from '$lib/game/rooms';
	import { cellIndex, decodeMask } from '$lib/game/visibility';
	import type { RoomConnection } from '$lib/net/room-connection.svelte';
	import Tabletop, { type CuePlay, type FloatText } from '$lib/tabletop/Tabletop.svelte';
	import { decodeFloor, FLOORS, type FloorId } from '$lib/game/floor';
	import { decodeLevels } from '$lib/game/terrain';
	import type { DiceThrow } from '$lib/tabletop/dice3d';
	import { diceToThrow } from '$lib/tabletop/dice-throw';
	import type { CameraView, HighlightKind, Pick, PreviewItem } from '$lib/tabletop/renderer';
	import { DEFAULT_LIGHT_RADIUS, LIGHT_COLORS, type Light } from '$lib/game/lights';
	import {
		ASSETS,
		footprintCells,
		footprintSize,
		obstaclesFor,
		placementProblem,
		propAt,
		type Prop,
		type Rotation
	} from '$lib/game/props';
	import { play, setAmbience, setMusic } from '$lib/audio/engine';
	import { fade, fly } from 'svelte/transition';
	import { ambienceFor, musicFor, SILENCE, soundsFor, type AudioState } from '$lib/audio/cues';
	import ActionBar from './ActionBar.svelte';
	import AudioControls from './AudioControls.svelte';
	import AdventurePanel from './AdventurePanel.svelte';
	import DirectorPanel from './DirectorPanel.svelte';
	import Decision from './Decision.svelte';
	import BuildPanel, { type BuildTool, type LightDraft, type PropDraft } from './BuildPanel.svelte';
	import CharacterSelect from './CharacterSelect.svelte';
	import CharacterSheet from './CharacterSheet.svelte';
	import TutorialCoach from './TutorialCoach.svelte';
	import Welcome from './Welcome.svelte';
	import {
		currentStep,
		loadProgress,
		NEW_PLAYER,
		record,
		saveProgress,
		signalOf,
		type Signal,
		type TutorialProgress
	} from './tutorial';
	import type { RoomAction } from '$lib/net/room-connection.svelte';
	import SectionEnd from './SectionEnd.svelte';
	import PropInspector from './PropInspector.svelte';
	import ChatPanel from './ChatPanel.svelte';
	import ScenePanel from './ScenePanel.svelte';
	import TokenPanel, { type TokenDraft } from './TokenPanel.svelte';

	let { conn }: { conn: RoomConnection } = $props();

	// `?perf`: a measuring script drives the room from the page (it sends only what a player could).
	$effect(() => {
		if (!new URLSearchParams(location.search).has('perf')) return;
		(window as { thirdfoldRoom?: RoomConnection }).thirdfoldRoom = conn;
		return () => delete (window as { thirdfoldRoom?: RoomConnection }).thirdfoldRoom;
	});

	/** How close (in cells) the pointer must be to a grid line to target the wall or door on it. */
	const EDGE_REACH = 0.22;

	// Local UI state only. Shared state lives in conn.room and changes only via server broadcasts.
	/** The camera view, remembered in this browser so a refresh keeps it. */
	let view = $state<CameraView>(savedView());

	function savedView(): CameraView {
		try {
			return localStorage.getItem('thirdfold:view') === 'tabletop' ? 'tabletop' : 'tactical';
		} catch {
			return 'tactical';
		}
	}

	$effect(() => {
		try {
			localStorage.setItem('thirdfold:view', view);
		} catch {
			// Storage unavailable: the view just isn't remembered.
		}
	});

	/** Which of the GM's workshop panels are open (folded until asked for), remembered here. */
	let folds = $state(savedFolds());

	function savedFolds(): { build: boolean; scene: boolean } {
		try {
			const saved = JSON.parse(localStorage.getItem('thirdfold:folds') ?? '{}');
			return { build: saved.build === true, scene: saved.scene === true };
		} catch {
			return { build: false, scene: false };
		}
	}

	$effect(() => {
		try {
			localStorage.setItem('thirdfold:folds', JSON.stringify(folds));
		} catch {
			// Storage unavailable: the panels just start folded again.
		}
	});

	/** Seconds until the next reconnect try, ticking while we wait. */
	let now = $state(Date.now());
	$effect(() => {
		if (conn.status !== 'reconnecting') return;
		const timer = setInterval(() => (now = Date.now()), 500);
		return () => clearInterval(timer);
	});
	const retryIn = $derived(
		conn.retryAt === null ? null : Math.max(0, Math.ceil((conn.retryAt - now) / 1000))
	);
	let tool = $state<BuildTool>('select');
	let selectedId = $state<string | null>(null);
	let placing = $state<TokenDraft | null>(null);
	/** GM: the kind of enemy the next click on the table brings on. */
	let spawning = $state<string | null>(null);
	let hover = $state<Pick | null>(null);
	/** First corner of the wall being drawn. */
	let wallStart = $state<GridPos | null>(null);
	/** First cell of the area being revealed, hidden or shaped. */
	let areaStart = $state<GridPos | null>(null);
	/** The level the GM's height tool sets. */
	let heightLevel = $state(5);
	/** The floor the GM's floor tool paints. */
	let floorDraft = $state<FloorId>('stone');

	let lightDraft = $state<LightDraft>({
		radius: DEFAULT_LIGHT_RADIUS,
		color: LIGHT_COLORS[0].color
	});
	let propDraft = $state<PropDraft>({ assetId: 'table', rotation: 0 });
	let selectedPropId = $state<string | null>(null);
	let copied = $state(false);
	let toast = $state<string | null>(null);
	/** A one-step undo offered with the toast (a deleted prop, put back). */
	let undo = $state<{ label: string; run: () => void } | null>(null);
	/** A prop put back by undo: its scale and hidden flag follow once it reappears. */
	let restoring: (Prop & { known: Set<string> }) | null = null;
	/** Small screens show one panel at a time over the table. */
	let sheet = $state<'table' | 'side' | 'chat'>('table');
	let barHeight = $state(0);
	/** Where tokens are announced to screen readers after a keyboard move. */
	let moved = $state('');
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
	const FOG_TOOLS: BuildTool[] = ['reveal', 'hide', 'reveal-room', 'hide-room'];
	/** Every edge that closes off a room, for the room tools' preview. */
	const boundary = $derived(room ? roomBoundary(room.objects) : new Set<string>());
	/** The walled room under the cursor while a room tool is out, or null over open ground. */
	const hoveredRoom = $derived(
		room && hover?.cell && (tool === 'reveal-room' || tool === 'hide-room')
			? roomAround(room.grid, boundary, hover.cell)
			: null
	);

	/** Cell indices as horizontal runs, one rectangle per run, for drawing. */
	function rowRuns(cells: readonly number[], width: number): [GridPos, GridPos][] {
		const sorted = [...cells].sort((a, b) => a - b);
		const runs: [GridPos, GridPos][] = [];
		for (const i of sorted) {
			const at = { x: i % width, y: Math.floor(i / width) };
			const last = runs.at(-1);
			if (last && last[1].y === at.y && last[1].x === at.x - 1) last[1] = at;
			else runs.push([at, at]);
		}
		return runs;
	}
	const me = $derived(conn.me);

	/** A new player's way into the game (see tutorial.ts): the welcome, then learning by doing. */
	let tutorial = $state<TutorialProgress>(NEW_PLAYER);
	let tutorialRoom: string | null = null;
	$effect(() => {
		const id = room?.id;
		if (!id || me?.role !== 'player' || tutorialRoom === id) return;
		tutorialRoom = id;
		tutorial = loadProgress(localStorage, id);
	});

	function setTutorial(next: TutorialProgress) {
		tutorial = next;
		if (room) saveProgress(localStorage, room.id, next);
	}

	function learned(signal: Signal) {
		if (me?.role !== 'player') return;
		const next = record(tutorial, signal);
		if (next !== tutorial) setTutorial(next);
	}

	/** Sends an action to the server, noting what the tutorial is waiting for. */
	function act(action: RoomAction): boolean {
		const sent = conn.send(action);
		const kindOf = (id: string) => adventure?.interactables.find((o) => o.id === id)?.kind;
		const signal = sent ? signalOf(action, kindOf) : null;
		if (signal) learned(signal);
		return sent;
	}
	const isGm = $derived(me?.role === 'gm');
	/** The GM's seat has no connection right now. */
	const gmAway = $derived(!!room?.players.some((p) => p.role === 'gm' && !p.connected));
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
		// Only on its own turn, and only as far as this turn allows (half when slowed).
		if (encounter.order[encounter.current]?.characterId !== myCharacter.id) return 0;
		return Math.max(0, encounter.speed - (encounter.moved[myCharacter.id] ?? 0));
	});
	/** Whose turn it is in a fight, when this viewer can see their token. */
	const active = $derived.by(() => {
		const encounter = adventure?.encounter;
		const up = encounter?.order[encounter.current];
		return up?.tokenId ? { tokenId: up.tokenId, enemy: up.kind === 'enemy' } : null;
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
	/** The ground's levels as far as this client knows them; null for a flat table. */
	const darkness = $derived(
		room?.darkness ? decodeMask(room.darkness, room.grid.width * room.grid.height) : null
	);
	/** Whether a cell is in one of the table's dark areas. */
	const isDark = (cell: GridPos) =>
		!!room && !!darkness && darkness[cellIndex(room.grid, cell)] === 1;
	const floor = $derived(
		room?.floor ? decodeFloor(room.floor, room.grid.width * room.grid.height) : null
	);
	const terrain = $derived(
		room?.terrain ? decodeLevels(room.terrain, room.grid.width * room.grid.height) : null
	);
	const blocked = $derived(
		room ? obstaclesFor(room.grid, room.objects, room.props, terrain, floor) : new Set<string>()
	);
	/** The last cinematic cue in the log, to play once. */
	let cuePlay = $state<CuePlay | null>(null);
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
		if ((tool === 'reveal-room' || tool === 'hide-room') && hover.cell) {
			const cells = hoveredRoom;
			if (!cells) return [{ kind: 'area', from: hover.cell, to: hover.cell, tone: 'invalid' }];
			return rowRuns(cells, room!.grid.width).map(([from, to]) => ({
				kind: 'area',
				from,
				to,
				tone: tool === 'reveal-room' ? 'reveal' : 'hide'
			}));
		}
		if (tool === 'floor' && hover.cell) {
			return [{ kind: 'area', from: areaStart ?? hover.cell, to: hover.cell, tone: 'valid' }];
		}
		if (tool === 'height' && hover.cell) {
			return [{ kind: 'area', from: areaStart ?? hover.cell, to: hover.cell, tone: 'valid' }];
		}
		if (tool === 'dark' && hover.cell) {
			const from = areaStart ?? hover.cell;
			return [{ kind: 'area', from, to: hover.cell, tone: isDark(from) ? 'reveal' : 'hide' }];
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
		const def = myCharacter.def;
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
		if (placing || spawning) return { cell: hoverCell, kind: occupant ? 'blocked' : 'place' };
		if (selected && !doorUnder(hover)) {
			const taken = occupant && occupant.id !== selected.id;
			return { cell: hoverCell, kind: taken || !reachable ? 'blocked' : 'move' };
		}
		return null;
	});

	const hint = $derived.by(() => {
		if (placing) return `Click an empty cell to place ${placing.name}. Esc to cancel.`;
		if (spawning) {
			const name = adventure?.director?.enemies.find((e) => e.kind === spawning)?.name;
			return `Click an empty cell to bring on ${name ?? 'the enemy'}. Esc to stop.`;
		}
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
		if (tool === 'dark') {
			const lifting = areaStart && isDark(areaStart);
			return areaStart
				? `Click the opposite corner cell to ${lifting ? 'lift the dark from' : 'darken'} the area. Esc to cancel.`
				: 'Dark area: click a cell to start an area (a dark cell lifts the dark instead).';
		}
		if (tool === 'floor') {
			const name = FLOORS.find((f) => f.id === floorDraft)!.name.toLowerCase();
			return areaStart
				? `Click the opposite corner cell to paint the area ${name}. Esc to cancel.`
				: `Paint floor: click a cell to start an area of ${name}.`;
		}
		if (tool === 'height') {
			return areaStart
				? `Click the opposite corner cell to set the area to level ${heightLevel}. Esc to cancel.`
				: `Shape ground: click a cell to start an area at level ${heightLevel}.`;
		}
		if (tool === 'reveal-room' || tool === 'hide-room') {
			if (hover?.cell && !hoveredRoom) return 'Open ground: pick a cell inside walls.';
			return `${tool === 'reveal-room' ? 'Reveal' : 'Hide'} room: click a cell inside a walled room to ${tool === 'reveal-room' ? 'reveal it to' : 'hide it from'} the players.`;
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
			? 'Click any token to move it, or open Build the table to add walls, props and light.'
			: 'Click one of your tokens to move it, or a door next to it to open it.';
	});

	function showToast(message: string) {
		toast = message;
	}

	$effect(() => {
		const err = conn.actionError;
		if (err) {
			showToast(err.message);
			play([{ kind: 'ui', sound: 'error' }]);
		}
	});

	// The table's sound, worked out from each change to the synced state (see audio/cues.ts).
	let heard: AudioState | null = null;
	let heardRoom: string | null = null;
	let heardSeq = -1;
	$effect(() => {
		if (!room || !me) return;
		const state = $state.snapshot({
			me: me.id,
			tokens: room.tokens,
			objects: room.objects,
			ambient: room.ambient,
			adventure
		}) as AudioState;
		if (heardRoom !== room.id) {
			heardRoom = room.id;
			heard = null;
			heardSeq = room.log.at(-1)?.seq ?? -1;
		}
		const fresh = room.log.filter((m) => m.seq > heardSeq);
		heardSeq = room.log.at(-1)?.seq ?? heardSeq;
		play(soundsFor(heard, state, fresh));
		heard = state;
		setMusic(musicFor(state.adventure, state.ambient));
		setAmbience(ambienceFor(state.adventure, state.ambient));
	});
	$effect(() => () => {
		setMusic(SILENCE);
		setAmbience(null);
	});

	$effect(() => {
		if (!room) return;
		const latest = room.log.at(-1);
		if (lastAnnouncedSeq === null) {
			lastAnnouncedSeq = latest?.seq ?? 0;
			return;
		}
		if (!latest || latest.seq <= lastAnnouncedSeq) return;
		const since = lastAnnouncedSeq;
		lastAnnouncedSeq = latest.seq;
		// A cue can arrive among other entries (a move notice after it): look at all new ones.
		const cued = room.log.flatMap((m) =>
			m.seq > since && m.kind === 'narration' && (m.cue || m.shot)
				? [{ seq: m.seq, cue: m.cue, shot: m.shot }]
				: []
		);
		if (cued.length) {
			const bell = room.props.find((p) => p.assetId === 'belfry-bell');
			cuePlay = {
				seq: cued.at(-1)!.seq,
				cues: [...new Set(cued.flatMap((c) => (c.cue ? [c.cue] : [])))],
				swingPropId: bell?.id ?? null,
				shot: cued.findLast((c) => c.shot)?.shot ?? null
			};
		}
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
		const timer = setTimeout(
			() => {
				toast = null;
				undo = null;
			},
			undo ? 8000 : 3500
		);
		return () => clearTimeout(timer);
	});

	function showUndo(message: string, label: string, run: () => void) {
		toast = message;
		undo = { label, run };
	}

	function deleteProp(prop: Prop) {
		act({ type: 'prop_delete', propId: prop.id });
		selectedPropId = null;
		showUndo(`${propName(prop)} removed.`, 'Undo', () => {
			restoring = { ...prop, known: new Set(room?.props.map((p) => p.id)) };
			act({ type: 'prop_create', assetId: prop.assetId, pos: prop.pos, rotation: prop.rotation });
		});
	}

	// The server gives a restored prop a new id: find it, then give back what create can't carry.
	$effect(() => {
		const props = room?.props;
		const was = restoring;
		if (!props || !was) return;
		const back = props.find(
			(p) =>
				!was.known.has(p.id) &&
				p.assetId === was.assetId &&
				p.pos.x === was.pos.x &&
				p.pos.y === was.pos.y
		);
		if (!back) return;
		restoring = null;
		if (was.scale !== back.scale || !!was.hidden !== !!back.hidden) {
			act({
				type: 'prop_update',
				propId: back.id,
				patch: { scale: was.scale, hidden: !!was.hidden }
			});
		}
	});

	/** Keys typed on the table itself (it takes focus) drive the selected token. */
	function onTable(target: EventTarget | null) {
		return target instanceof HTMLCanvasElement;
	}

	function propName(prop: Prop) {
		return ASSETS[prop.assetId]?.name ?? 'Prop';
	}

	function setTool(next: BuildTool) {
		tool = next;
		spawning = null;
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
			act({ type: 'token_create', ...placing, pos: pick.cell });
			placing = null;
			return;
		}
		if (spawning) {
			if (!pick.cell) return;
			if (tokenAt(room.tokens, pick.cell)) return showToast('That cell is taken.');
			act({
				type: 'adventure_direct',
				direction: { op: 'spawn', kind: spawning, pos: pick.cell }
			});
			return;
		}
		switch (tool) {
			case 'wall':
				return clickWall(pick);
			case 'door':
				if (pick.edge) act({ type: 'object_create', kind: 'door', ...pick.edge });
				return;
			case 'floor': {
				if (!pick.cell) return;
				if (!areaStart) {
					areaStart = pick.cell;
					return;
				}
				act({ type: 'floor_set', from: areaStart, to: pick.cell, floor: floorDraft });
				areaStart = null;
				return;
			}
			case 'height': {
				if (!pick.cell) return;
				if (!areaStart) {
					areaStart = pick.cell;
					return;
				}
				act({ type: 'terrain_set', from: areaStart, to: pick.cell, level: heightLevel });
				areaStart = null;
				return;
			}
			case 'reveal':
			case 'hide': {
				if (!pick.cell) return;
				if (!areaStart) {
					areaStart = pick.cell;
					return;
				}
				act({ type: 'fog_area', from: areaStart, to: pick.cell, reveal: tool === 'reveal' });
				areaStart = null;
				return;
			}
			case 'dark': {
				if (!pick.cell) return;
				if (!areaStart) {
					areaStart = pick.cell;
					return;
				}
				const dark = !isDark(areaStart);
				act({ type: 'darkness_set', from: areaStart, to: pick.cell, dark });
				areaStart = null;
				return;
			}
			case 'reveal-room':
			case 'hide-room': {
				if (!pick.cell) return;
				act({ type: 'fog_room', cell: pick.cell, reveal: tool === 'reveal-room' });
				return;
			}
			case 'erase': {
				const target = objectUnder(pick);
				if (target) return void act({ type: 'object_delete', objectId: target.id });
				const light = lightUnder(pick);
				if (light) return void act({ type: 'light_delete', lightId: light.id });
				const prop = propUnder(pick);
				if (prop) act({ type: 'prop_delete', propId: prop.id });
				return;
			}
			case 'prop': {
				if (!pick.cell) return;
				const placement = { ...propDraft, pos: pick.cell };
				const problem = placementProblem(room.grid, placement, room.tokens, room.props);
				if (problem) return showToast(problem.message);
				act({ type: 'prop_create', ...placement });
				return;
			}
			case 'light': {
				const existing = lightUnder(pick);
				if (existing) {
					act({ type: 'light_update', lightId: existing.id, patch: { on: !existing.on } });
				} else if (pick.cell) {
					act({ type: 'light_create', pos: pick.cell, ...lightDraft });
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
		act({ type: 'object_create', kind: 'wall', a: wallStart, b: end });
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
			act({ type: 'prop_update', propId: selectedProp.id, patch: { pos: pick.cell } });
			return;
		}
		const target = adventureTarget(pick);
		if (target) {
			if (!target.inReach) {
				return showToast(target.kind === 'act' ? 'Out of reach.' : 'Walk up to it first.');
			}
			act(
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
			act({ type: 'door_toggle', objectId: door.id });
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
		act({ type: 'token_move', tokenId: selected.id, to: pick.cell });
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
				act({ type: 'prop_update', propId: selectedProp.id, patch: { rotation } });
			}
			return;
		}
		if (isGm && !typing && selectedProp && (event.key === 'Delete' || event.key === 'Backspace')) {
			deleteProp(selectedProp);
			return;
		}
		if (!typing && event.key.startsWith('Arrow') && onTable(event.target) && selected) {
			const step: Record<string, [number, number]> = {
				ArrowUp: [0, -1],
				ArrowDown: [0, 1],
				ArrowLeft: [-1, 0],
				ArrowRight: [1, 0]
			};
			const [dx, dy] = step[event.key] ?? [0, 0];
			const to = { x: selected.pos.x + dx, y: selected.pos.y + dy };
			event.preventDefault();
			if (!room || to.x < 0 || to.y < 0 || to.x >= room.grid.width || to.y >= room.grid.height) {
				moved = `${selected.name} is at the edge of the table.`;
				return;
			}
			act({ type: 'token_move', tokenId: selected.id, to });
			moved = `${selected.name}: moving to column ${to.x + 1}, row ${to.y + 1}.`;
			return;
		}
		if (event.key === 'Escape') {
			if (spawning) {
				spawning = null;
				return;
			}
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
			g: 'height',
			f: 'floor',
			n: 'dark',
			...(room?.fog.enabled ? { r: 'reveal', h: 'hide', o: 'reveal-room', k: 'hide-room' } : {})
		};
		const next = shortcut[event.key.toLowerCase()];
		if (next) setTool(next);
	}

	// The tutorial's first step is done once the character has walked somewhere.
	let lastSpot: { id: string; x: number; y: number } | null = null;
	$effect(() => {
		const t = myCharacterToken;
		if (!t) return;
		const moved = lastSpot?.id === t.id && (lastSpot.x !== t.pos.x || lastSpot.y !== t.pos.y);
		lastSpot = { id: t.id, x: t.pos.x, y: t.pos.y };
		if (moved && adventure?.stage === 'playing') learned('move');
	});

	$effect(() => {
		if (sheetOpen) learned('sheet');
	});

	// The first find: coming up beside it, then finding what it holds (once the server says so).
	const firstFind = $derived(adventure?.firstFind ?? null);
	const foundFirst = $derived.by(() => {
		const id = firstFind?.clueId;
		const clue = id ? adventure?.clues.find((c) => c.id === id && c.mine) : undefined;
		return clue ? { title: clue.title, text: clue.text } : null;
	});
	$effect(() => {
		const t = myCharacterToken;
		if (!t || !firstFind || adventure?.stage !== 'playing') return;
		if (firstFind.cells.some((c) => gridDistance(c, t.pos) <= 1)) learned('approach');
	});
	$effect(() => {
		if (foundFirst) {
			learned('approach');
			learned('inspect');
		}
	});
	/** Onboarding's glow on the table, while the player is being shown to it. */
	const beacon = $derived.by((): PreviewItem[] => {
		const step = tutorial.stage === 'tutorial' ? currentStep(tutorial, !!firstFind) : null;
		if (!firstFind || (step?.id !== 'approach' && step?.id !== 'inspect')) return [];
		return firstFind.cells.map((at) => ({ kind: 'beacon', at }));
	});

	const firstGoal = $derived(
		adventure?.objectives.find((o) => !o.done && !o.optional)?.text ?? null
	);
	const learning = $derived(
		me?.role === 'player' && !!myCharacter && adventure?.stage === 'playing'
	);

	// Introduce a character when this player takes it (not when a reload finds it already taken).
	$effect(() => {
		if (!room) return;
		const id = myCharacter?.id ?? null;
		if (knownCharacter !== undefined && id && id !== knownCharacter) introFor = id;
		knownCharacter = id;
	});

	// An aimed action is dropped when it can no longer be used.
	$effect(() => {
		const encounter = adventure?.encounter;
		const up = encounter?.order[encounter.current];
		const myTurn = !encounter || up?.characterId === myCharacter?.id;
		if (targeting && (!myCharacter || myCharacter.downed || !myTurn)) targeting = null;
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

<div class="room" style:--below-bar={barHeight ? `calc(${barHeight}px + 1.25rem)` : null}>
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
				preview={beacon.length ? [...preview, ...beacon] : preview}
				selectedId={selected?.id ?? null}
				{fallen}
				{floats}
				{terrain}
				{floor}
				{darkness}
				environment={room.environment}
				cue={cuePlay}
				motion={conn.motion}
				{active}
				{highlight}
				{view}
				{onClick}
				onHover={(pick) => (hover = pick)}
			/>
		</div>
	{/if}

	<header class="bar" bind:clientHeight={barHeight}>
		<span class="group">
			<a class="brand" href={resolve('/')}>thirdfold</a>
			<span class="code" title="Room code">{room?.id}</span>
		</span>
		<span class="group">
			<button type="button" onclick={copyInvite}
				>{copied ? 'Link copied' : 'Copy invite link'}</button
			>
			{#if isGm && room}
				<button
					type="button"
					aria-pressed={room.listed}
					title={room.listed
						? 'Anyone can find this game on the front page and join. Click to make it invite-only.'
						: 'Only people with the invite link can join. Click to list it for anyone to find.'}
					onclick={() => act({ type: 'room_listing', listed: !room!.listed })}
				>
					{room.listed ? 'Open to all' : 'Invite only'}
				</button>
			{/if}
		</span>
		<div class="views" role="group" aria-label="Camera">
			<button type="button" aria-pressed={view === 'tactical'} onclick={() => (view = 'tactical')}>
				Tactical
			</button>
			<button type="button" aria-pressed={view === 'tabletop'} onclick={() => (view = 'tabletop')}>
				Tabletop
			</button>
		</div>
		<AudioControls />
		<span class="status" data-status={conn.status}>{STATUS_LABEL[conn.status]}</span>
	</header>

	{#if room && me}
		<aside class="side" data-open={sheet === 'side'}>
			{#if isGm && adventure && adventure.stage !== 'choosing'}
				<div class="panel">
					<DirectorPanel
						{adventure}
						paused={room.paused}
						ambient={room.ambient}
						lights={room.lights}
						fogEnabled={room.fog.enabled}
						fogShared={room.fog.shared}
						{tool}
						{spawning}
						send={act}
						onTool={setTool}
						onSpawn={(kind) => {
							setTool('select');
							spawning = kind;
						}}
						onSelectToken={(id) => {
							setTool('select');
							selectedId = id;
						}}
						onFogAll={(reveal) =>
							act({
								type: 'fog_area',
								from: { x: 0, y: 0 },
								to: { x: room.grid.width - 1, y: room.grid.height - 1 },
								reveal
							})}
						onError={showToast}
					/>
				</div>
			{/if}

			{#if adventure || isGm}
				<div class="panel">
					<AdventurePanel
						{adventure}
						{isGm}
						players={room.players}
						adventures={room.adventures}
						send={act}
					/>
				</div>
			{/if}

			<section class="panel" aria-label="Players">
				<h2 class="section-title">At the table</h2>
				<ul class="players">
					{#each room.players as player (player.id)}
						<li class:offline={!player.connected} in:fly={{ x: 12, duration: 260 }}>
							<span class="dot" title={player.connected ? 'Online' : 'Offline'}></span>
							<span class="name">{player.name}{player.id === me.id ? ' (you)' : ''}</span>
							<span class="role" data-role={player.role}>{ROLE_LABEL[player.role]}</span>
						</li>
					{/each}
				</ul>
			</section>

			{#if selectedProp}
				<div class="panel">
					<PropInspector
						prop={selectedProp}
						send={act}
						onDone={() => (selectedPropId = null)}
						onRemove={() => selectedProp && deleteProp(selectedProp)}
					/>
				</div>
			{/if}

			{#if isGm}
				<details class="panel fold" bind:open={folds.build}>
					<summary>
						<span class="section-title">Build the table</span>
						{#if tool !== 'select'}<span class="current">{tool.replace('-', ' ')}</span>{/if}
					</summary>
					<BuildPanel
						{tool}
						fogEnabled={room.fog.enabled}
						fogShared={room.fog.shared}
						onFogShared={(shared) => act({ type: 'fog_share', shared })}
						ambient={room.ambient}
						{lightDraft}
						{propDraft}
						onTool={setTool}
						onPropDraft={(draft) => (propDraft = draft)}
						onAmbient={(ambient) => act({ type: 'ambient_set', ambient })}
						environment={room.environment}
						onEnvironment={(environment) => act({ type: 'environment_set', environment })}
						onLightDraft={(draft) => (lightDraft = draft)}
						{heightLevel}
						onHeightLevel={(level) => (heightLevel = level)}
						{floorDraft}
						onFloorDraft={(next) => (floorDraft = next)}
						onFog={(enabled) => {
							if (!enabled && FOG_TOOLS.includes(tool)) setTool('select');
							act({ type: 'fog_set', enabled });
						}}
						onFogAll={(reveal) =>
							act({
								type: 'fog_area',
								from: { x: 0, y: 0 },
								to: { x: room.grid.width - 1, y: room.grid.height - 1 },
								reveal
							})}
					/>
				</details>
			{/if}

			{#if isGm}
				<details class="panel fold" bind:open={folds.scene}>
					<summary>
						<span class="section-title">Scenes and saves</span>
						<span class="current">{room.sceneName}</span>
					</summary>
					<ScenePanel
						sceneName={room.sceneName}
						reply={conn.sceneReply}
						send={act}
						onError={showToast}
					/>
				</details>
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
						send={act}
					/>
				</div>
			{/if}
		</aside>

		<section class="chat-dock panel" data-open={sheet === 'chat'}>
			<ChatPanel log={room.log} myId={me.id} send={act} onError={showToast} />
		</section>

		<nav class="dock-tabs" aria-label="Panels">
			<button type="button" aria-pressed={sheet === 'table'} onclick={() => (sheet = 'table')}>
				Table
			</button>
			<button type="button" aria-pressed={sheet === 'side'} onclick={() => (sheet = 'side')}>
				{isGm ? 'GM tools' : 'Party'}
			</button>
			<button type="button" aria-pressed={sheet === 'chat'} onclick={() => (sheet = 'chat')}>
				Chat
			</button>
		</nav>

		<p class="visually-hidden" aria-live="polite">{moved}</p>

		{#if myCharacter && (introFor === myCharacter.id || sheetOpen)}
			<CharacterSheet
				character={myCharacter.def}
				card={myCharacter.card}
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
						<span class="big num">{rollCard.roll.total}</span>
						<span class="how">{formatBreakdown(rollCard.roll)}</span>
					{:else if rollCard.kind === 'check'}
						<span class="who">{rollCard.authorName} · {rollCard.action}</span>
						<span class="big num" class:miss={!rollCard.success}>{rollCard.roll.total}</span>
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
							<span class="big num" class:heal={rollCard.amount > 0}>
								{rollCard.amount > 0 ? '+' : ''}{rollCard.amount}
							</span>
						{/if}
						<span class="how">{rollCard.text}</span>
					{:else}
						<span class="who"
							>{rollCard.authorName} · {rollCard.attack} → {rollCard.targetName}</span
						>
						<span class="big num" class:miss={!rollCard.hit}>
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
				send={act}
			/>
		{/if}

		{#if learning && adventure && myCharacter && tutorial.stage === 'welcome' && introFor === null && !sheetOpen}
			<Welcome
				{adventure}
				characterName={myCharacter.def.name}
				onLearn={() => setTutorial({ ...tutorial, stage: 'tutorial' })}
				onSkip={() => setTutorial({ ...tutorial, stage: 'done' })}
			/>
		{/if}

		{#if learning && tutorial.stage === 'tutorial' && !adventure?.encounter}
			<TutorialCoach
				progress={tutorial}
				hasFind={!!firstFind || tutorial.done.includes('inspect')}
				found={foundFirst}
				goal={firstGoal}
				onDone={learned}
				onStart={() => setTutorial({ ...tutorial, stage: 'done' })}
				onSkip={() => setTutorial({ ...tutorial, stage: 'done' })}
			/>
		{/if}

		{#if adventure && me.role === 'player' && !myCharacter && adventure.stage !== 'complete' && adventure.stage !== 'defeat'}
			<CharacterSelect {adventure} players={room.players} send={act} />
		{/if}

		{#if adventure && endKey && dismissedEnd !== endKey}
			<SectionEnd
				{adventure}
				players={room.players}
				me={me.id}
				{isGm}
				send={act}
				onClose={() => (dismissedEnd = endKey)}
			/>
		{/if}
	{:else}
		<div class="loading" role="status">
			<picture>
				<source
					srcset={asset('/brand/thirdfold-mark.svg')}
					media="(prefers-reduced-motion: reduce)"
				/>
				<img src={asset('/brand/thirdfold-mark-animated.svg')} alt="" />
			</picture>
			<p>{conn.error?.message ?? 'Connecting to the table…'}</p>
		</div>
	{/if}

	<!-- Notices over the table stack in its free space, between the chat and the side panels. -->
	<div class="hud hud-top">
		{#if conn.status === 'reconnecting'}
			<div class="banner reconnecting" role="alert" transition:fly={{ y: -10, duration: 240 }}>
				<span>
					Connection lost. {retryIn === null || retryIn === 0
						? 'Reconnecting…'
						: `Trying again in ${retryIn}s`}{conn.attempt > 1 ? ` (attempt ${conn.attempt})` : ''}.
					The table below is as you last saw it.
				</span>
				<button type="button" onclick={() => conn.retryNow()} disabled={conn.retryAt === null}>
					Try now
				</button>
			</div>
		{/if}
		{#if room && me}
			{#if room.paused && gmAway && !isGm}
				<p class="paused" role="status" transition:fly={{ y: -8, duration: 220 }}>
					The GM lost their connection. The game waits for them.
				</p>
			{:else if room.paused}
				<p class="paused" role="status" transition:fly={{ y: -8, duration: 220 }}>
					Paused{isGm ? ': players can’t move or act until you carry on' : ' by the GM'}
				</p>
			{:else if gmAway && !isGm}
				<p class="paused" role="status" transition:fly={{ y: -8, duration: 220 }}>
					The GM is away.
				</p>
			{/if}
			{#if adventure?.encounter}
				{@const encounter = adventure.encounter}
				<ol class="encounter" aria-label={`Round ${encounter.round}, turn order`}>
					<li class="round num">Round {encounter.round}</li>
					{#if encounter.counter}
						<li class="counter">
							{encounter.counter.label}
							{encounter.counter.count}/{encounter.counter.of}
						</li>
					{/if}
					{#each encounter.order as t, i (i)}
						{@const foe = t.tokenId
							? encounter.enemies.find((e) => e.tokenId === t.tokenId)
							: undefined}
						<li
							class="turn"
							class:enemy={t.kind === 'enemy'}
							class:current={i === encounter.current}
							class:out={t.out}
							aria-current={i === encounter.current ? 'true' : undefined}
							title={`Initiative ${t.initiative}`}
						>
							<span class="init">{t.initiative}</span>
							{t.name}
							{#if foe}
								<span class="foe-hp"
									><span style:transform={`scaleX(${foe.hp / foe.maxHp})`}></span></span
								>
								<span class="foe-num num">{foe.hp}/{foe.maxHp}</span>
							{/if}
						</li>
					{/each}
				</ol>
			{/if}
			{#if adventure && endKey && dismissedEnd === endKey}
				<button
					class="summary-pill"
					type="button"
					in:fly={{ y: -8, duration: 220 }}
					onclick={() => (dismissedEnd = null)}
				>
					{adventure.stage === 'complete' ? 'Adventure complete' : 'Adventure failed'} · Summary
				</button>
			{/if}
			{#if me.role === 'player' && !adventure}
				<p class="waiting" role="status">
					You’re at the table. The GM is setting up; the story starts soon. Say hello in the chat
					meanwhile.
				</p>
			{/if}
		{/if}
		{#if toast}
			<div
				class="toast"
				role="status"
				in:fly={{ y: -10, duration: 220 }}
				out:fade={{ duration: 140 }}
			>
				{toast}
				{#if undo}
					<span class="undo-clock" aria-hidden="true"></span>
					<button
						type="button"
						onclick={() => {
							undo?.run();
							undo = null;
							toast = null;
						}}
					>
						{undo.label}
					</button>
				{/if}
			</div>
		{/if}
	</div>

	<div class="hud hud-bottom">
		{#if room && me}
			{#if adventure && myCharacter && myCharacterToken}
				<div class="action-dock" data-hidden={sheet !== 'table'}>
					<ActionBar
						{adventure}
						character={myCharacter}
						token={myCharacterToken}
						tokens={room.tokens}
						{blocked}
						{targeting}
						onTargeting={(id) => (targeting = id)}
						onSheet={() => (sheetOpen = true)}
						send={act}
					/>
				</div>
			{/if}
			<p class="hint" aria-live="polite" data-hidden={sheet !== 'table'}>{hint}</p>
		{/if}
		{#if conn.status === 'closed' && conn.error}
			<div class="banner error" role="alert" in:fly={{ y: 10, duration: 240 }}>
				{conn.error.message}
				<button type="button" onclick={() => location.reload()}>Reconnect</button>
			</div>
		{/if}
	</div>
</div>

<style>
	/*
	 * The room's frame: the header across the top, the side panels down the right, the chat in the
	 * bottom left, and everything else over the table in the free space between them.
	 */
	.room {
		--below-bar: 5rem;
		--tabs-h: 0rem;
		--edge: 0.75rem;
		--side-w: 17rem;
		--chat-w: 21rem;
		--free-left: calc(var(--chat-w) + var(--edge) * 2);
		--free-right: calc(var(--side-w) + var(--edge) * 2);
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
		gap: var(--sp-4) var(--sp-6);
		padding: var(--sp-4) var(--sp-5);
		background: var(--panel);
		border: 1px solid var(--border);
		border-radius: var(--radius-bar, var(--radius-md));
		backdrop-filter: blur(6px);
	}

	.bar .group {
		display: flex;
		align-items: center;
		gap: var(--sp-3);
	}

	.bar .group + .group {
		padding-left: var(--sp-4);
		border-left: 1px solid var(--border);
	}

	.brand {
		font-weight: 700;
		color: var(--text);
		text-decoration: none;
		margin-right: var(--sp-2);
	}

	.code {
		font-family: var(--font-mono);
		letter-spacing: 0.15em;
		color: var(--muted);
	}

	.views {
		display: flex;
		gap: var(--sp-2);
		margin-left: auto;
	}

	.status {
		font-size: var(--fs-sm);
		color: var(--muted);
	}

	.status::before {
		content: '';
		display: inline-block;
		width: 0.5rem;
		height: 0.5rem;
		margin-right: var(--sp-3);
		border-radius: 50%;
		border: 1px solid currentColor;
	}

	.status[data-status='connected']::before {
		background: currentColor;
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
		top: var(--below-bar);
		right: var(--edge);
		bottom: var(--edge);
		width: min(var(--side-w), calc(100% - var(--edge) * 2));
		display: flex;
		flex-direction: column;
		gap: var(--sp-4);
		overflow-y: auto;
		pointer-events: none;
	}

	.panel {
		pointer-events: auto;
		padding: var(--sp-5);
		background: var(--panel);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		backdrop-filter: blur(6px);
	}

	.fold summary {
		display: flex;
		align-items: baseline;
		gap: var(--sp-4);
		cursor: pointer;
		list-style: none;
	}

	.fold summary::-webkit-details-marker {
		display: none;
	}

	.fold summary::before {
		content: '▸';
		display: inline-block;
		color: var(--muted);
		transition: transform var(--dur-fast) var(--ease-out);
	}

	.fold[open] summary::before {
		transform: rotate(90deg);
	}

	.fold summary .current {
		margin-left: auto;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: var(--fs-xs);
		color: var(--accent);
	}

	.fold[open] summary {
		margin-bottom: var(--sp-4);
	}

	/* The summary names the panel; its own heading would say it twice. */
	.fold :global(> section > h2:first-child) {
		display: none;
	}

	.panel .section-title {
		margin-bottom: var(--sp-4);
	}

	.players {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: var(--sp-3);
	}

	.players li {
		display: flex;
		align-items: center;
		gap: var(--sp-4);
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
		font-size: var(--fs-xs);
		padding: var(--sp-1) var(--sp-3);
		border-radius: var(--radius-sm);
		border: 1px solid var(--border);
		color: var(--muted);
	}

	.role[data-role='gm'] {
		border-color: var(--accent);
		color: var(--accent);
	}

	.chat-dock {
		position: absolute;
		left: var(--edge);
		bottom: var(--edge);
		width: min(var(--chat-w), calc(100% - var(--edge) * 2));
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
		gap: var(--sp-2);
		padding: var(--sp-6) var(--sp-7);
		background: var(--panel-solid);
		border: 1px solid var(--accent);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-md);
		pointer-events: none;
		animation: pop 260ms var(--ease-out);
	}

	.roll-card .who {
		color: var(--muted);
		font-size: var(--fs-sm);
	}

	.roll-card .big {
		font-size: var(--fs-display);
		font-weight: 700;
		line-height: 1;
		color: var(--accent);
	}

	.roll-card .how {
		font-family: var(--font-mono);
		font-size: var(--fs-sm);
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

	.waiting {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: center;
		gap: var(--sp-4);
		width: max-content;
		max-width: 100%;
		margin: 0;
		padding: var(--sp-4) var(--sp-6);
		background: var(--panel-solid);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		text-align: center;
	}

	.paused {
		margin: 0;
		padding: var(--sp-3) var(--sp-6);
		background: var(--panel);
		border: 1px solid var(--accent);
		border-radius: var(--radius-pill);
		color: var(--accent);
		font-weight: 700;
		letter-spacing: 0.04em;
		pointer-events: none;
	}

	.hint {
		margin: 0;
		padding: var(--sp-4) var(--sp-5);
		max-width: 100%;
		background: var(--panel);
		border: 1px solid var(--border);
		border-radius: var(--radius-pill);
		color: var(--muted);
		font-size: var(--fs-sm);
		pointer-events: none;
	}

	.toast {
		overflow: hidden;
		display: flex;
		align-items: center;
		gap: var(--sp-5);
		padding: var(--sp-4) var(--sp-6);
		max-width: 100%;
		background: var(--panel-solid);
		border: 1px solid var(--danger);
		border-radius: var(--radius-md);
	}

	.encounter .counter {
		color: var(--accent);
		font-weight: 700;
	}

	.encounter {
		list-style: none;
		margin: 0;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--sp-5);
		padding: var(--sp-3) var(--sp-6);
		max-width: 100%;
		background: var(--panel-solid);
		border: 1px solid var(--danger);
		border-radius: var(--radius-pill);
		font-size: var(--fs-sm);
		pointer-events: none;
	}

	.encounter .round {
		font-weight: 700;
		color: var(--danger);
	}

	.encounter .turn {
		display: inline-flex;
		align-items: center;
		gap: var(--sp-3);
		padding: var(--sp-1) var(--sp-4);
		border-radius: var(--radius-pill);
		border: 1px solid transparent;
		font-variant-numeric: tabular-nums;
	}
	.encounter .turn.enemy {
		color: var(--danger);
	}
	.encounter .turn.current {
		border-color: var(--accent);
		background: color-mix(in srgb, var(--accent) 22%, transparent);
		font-weight: 700;
		animation: take-turn 640ms var(--ease-out);
	}

	/* The turn passes: the chip whose turn it is catches the light, like brass turned to a flame. */
	.encounter .turn {
		position: relative;
		overflow: hidden;
	}

	.encounter .turn.current::after {
		content: '';
		position: absolute;
		inset: 0;
		background: linear-gradient(
			100deg,
			transparent 30%,
			rgba(255, 236, 190, 0.55) 50%,
			transparent 70%
		);
		transform: translateX(-110%);
		animation: glint 900ms 120ms var(--ease-out) both;
		pointer-events: none;
	}

	@keyframes take-turn {
		from {
			transform: scale(0.92);
			box-shadow: 0 0 0 0 rgba(224, 164, 88, 0.7);
		}
		60% {
			transform: scale(1.06);
			box-shadow: 0 0 0 6px rgba(224, 164, 88, 0);
		}
	}

	@keyframes glint {
		to {
			transform: translateX(110%);
		}
	}

	.undo-clock {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		height: 2px;
		background: var(--accent);
		transform-origin: left;
		animation: drain 8s linear both;
	}

	@keyframes drain {
		to {
			transform: scaleX(0);
		}
	}

	@keyframes drain-fade {
		to {
			opacity: 0;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.encounter .turn.current,
		.encounter .turn.current::after {
			animation: none;
		}

		/* The time left still shows: as a fading bar instead of a moving one. */
		.undo-clock {
			animation: drain-fade 8s linear both !important;
		}
	}
	.encounter .turn.out {
		opacity: 0.4;
		text-decoration: line-through;
	}
	.encounter .init {
		font-size: var(--fs-xs);
		color: var(--muted);
	}
	.foe-num {
		font-size: var(--fs-xs);
	}

	.foe-hp {
		width: 4.5rem;
		height: 0.5rem;
		border-radius: var(--radius-pill);
		background: var(--panel-sunk);
		border: 1px solid var(--border);
		overflow: hidden;
	}

	.foe-hp span {
		display: block;
		height: 100%;
		background: var(--danger);
		transform-origin: left;
		transition: transform var(--dur) var(--ease-out);
	}

	.action-dock {
		max-width: 100%;
	}

	.roll-card .big.miss {
		color: var(--muted);
		font-size: var(--fs-2xl);
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
		place-content: center;
		justify-items: center;
		gap: var(--sp-5);
		color: var(--muted);
	}

	.loading img {
		display: block;
		width: min(16rem, 60vw);
		height: auto;
	}

	.loading p {
		margin: 0;
	}

	.banner.reconnecting {
		border-color: var(--accent);
	}

	.summary-pill {
		padding: var(--sp-3) var(--sp-6);
		border: 1px solid var(--accent);
		border-radius: var(--radius-pill);
		background: var(--panel-solid);
		color: var(--accent);
		font-size: var(--fs-sm);
		cursor: pointer;
	}

	.banner {
		display: flex;
		gap: var(--sp-5);
		align-items: center;
		padding: var(--sp-4) var(--sp-6);
		background: var(--panel-solid);
		border: 1px solid var(--danger);
		border-radius: var(--radius-md);
		max-width: 100%;
	}
	.dock-tabs {
		display: none;
	}

	.hud {
		position: absolute;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--sp-3);
		pointer-events: none;
		z-index: var(--z-hud);
	}

	.hud > :global(*) {
		max-width: 100%;
	}

	.hud :global(button) {
		pointer-events: auto;
	}

	.hud-top {
		top: var(--below-bar);
		left: var(--edge);
		right: var(--free-right);
	}

	.hud-bottom {
		bottom: var(--edge);
		left: var(--free-left);
		right: var(--free-right);
	}

	.hud-bottom .action-dock {
		pointer-events: auto;
	}

	/* A wide screen gives the side panels more room; a narrow one takes it from the chat. */
	@media (min-width: 80rem) {
		.room {
			--side-w: 19rem;
		}
	}

	@media (max-width: 64rem) {
		.room {
			--chat-w: 17rem;
		}
	}

	/* Small screens: the table fills the screen and one panel at a time slides up over it. */
	@media (max-width: 48rem) {
		.room {
			--tabs-h: 3.5rem;
			--free-left: var(--sp-4);
			--free-right: var(--sp-4);
		}

		.bar {
			top: var(--sp-4);
			left: var(--sp-4);
			right: var(--sp-4);
			padding: var(--sp-3) var(--sp-4);
			border-radius: var(--radius-bar-wrapped, var(--radius-md));
		}

		.views {
			margin-left: 0;
		}

		/* Who and where on the first line, with the connection beside it; the controls below. */
		.bar > :global(*) {
			order: 2;
		}

		.bar > .group:first-child {
			order: 0;
		}

		.bar > .status {
			order: 1;
			margin-left: auto;
		}

		.bar .group + .group {
			padding-left: 0;
			border-left: 0;
		}

		.bar :global(button) {
			padding: var(--sp-2) var(--sp-4);
			font-size: var(--fs-sm);
		}

		.dock-tabs {
			position: absolute;
			left: var(--sp-4);
			right: var(--sp-4);
			bottom: var(--sp-4);
			z-index: var(--z-panel);
			display: grid;
			grid-template-columns: repeat(3, 1fr);
			gap: var(--sp-2);
			padding: var(--sp-2);
			background: var(--panel);
			border: 1px solid var(--border);
			border-radius: var(--radius-lg);
			backdrop-filter: blur(6px);
		}

		.dock-tabs button {
			min-height: 2.75rem;
		}

		.side,
		.chat-dock {
			display: none;
		}

		.side[data-open='true'],
		.chat-dock[data-open='true'] {
			display: flex;
			top: auto;
			left: var(--sp-4);
			right: var(--sp-4);
			bottom: calc(var(--tabs-h) + var(--sp-5));
			width: auto;
			max-height: min(70vh, calc(100% - var(--below-bar) - var(--tabs-h) - 1rem));
			z-index: var(--z-panel);
		}

		.chat-dock[data-open='true'] {
			height: min(28rem, 60vh);
		}

		/* A sheet slides up from the tabs as it opens. */
		.side[data-open='true'],
		.chat-dock[data-open='true'] {
			transition:
				transform var(--dur) var(--ease-out),
				opacity var(--dur) var(--ease-out);
		}

		@starting-style {
			.side[data-open='true'],
			.chat-dock[data-open='true'] {
				transform: translateY(1.5rem);
				opacity: 0;
			}
		}

		.hint[data-hidden='true'],
		.action-dock[data-hidden='true'] {
			display: none;
		}

		.hud-top {
			left: var(--sp-4);
			right: var(--sp-4);
		}

		.hud-bottom {
			left: var(--sp-4);
			right: var(--sp-4);
			bottom: calc(var(--tabs-h) + var(--sp-5));
		}
	}
</style>
