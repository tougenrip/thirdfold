// What each viewer is told about the adventure. Like the scene views in
// server/views.ts, this is filtered per viewer: enemies only when their token
// is in that viewer's view, things to interact with only once their cells
// have been seen, and the read-aloud passages only for the GM.

import type { AdventureView, Objective, SessionSummary } from '../../src/lib/adventure/adventure';
import { defenseFor } from '../../src/lib/adventure/characters';
import { cellIndex, type CellMask } from '../../src/lib/game/visibility';
import type { SavedScene } from '../../src/lib/game/protocol';
import type { Player, Room } from '../rooms';
import { AMBUSH, type AdventureDef } from './define';
import {
	chapterNumber,
	characterOf,
	content,
	counterOf,
	directorOptions,
	endingAnswer,
	objectCells,
	objectState,
	optionLabel,
	shownState,
	usesLeft,
	verbsFor
} from './engine';
import type { AdventureState, Statuses } from './state';
import { actionOfVerb, objectDef } from './world';

/** Where a story saved now had got to, for the GM's list of saves (null for a table without one). */
export function storySummary(room: Room): SavedScene['story'] {
	const adventure = room.adventure;
	if (!adventure) return null;
	const A = content(adventure);
	return {
		title: A.title,
		chapter: A.chapters[adventure.chapter].title,
		location: A.locations[adventure.location].name,
		party: [...adventure.characters].flatMap(([id, state]) => {
			const token = room.tokens.get(state.tokenId);
			if (!token) return [];
			const player = token.ownerId && room.players.get(token.ownerId);
			const name = A.characters[id]?.name ?? id;
			return [player ? `${name} (${player.name})` : name];
		})
	};
}

/**
 * What the party is trying to do: the objectives of every chapter so far at
 * this location, done or not, leaving out those not yet heard of.
 */
export function objectivesFor(A: AdventureDef, adventure: AdventureState): Objective[] {
	if (adventure.stage === 'choosing')
		return [{ id: 'choose', text: 'Choose your characters', done: false }];
	const events = adventure.events;
	const here = A.chapters[adventure.chapter].location;
	const ids = Object.keys(A.chapters);
	return ids
		.slice(0, ids.indexOf(adventure.chapter) + 1)
		.filter((id) => A.chapters[id].location === here)
		.flatMap((id) => A.chapters[id].objectives)
		.filter((o) => !o.after || events.includes(o.after))
		.map((o) => ({
			id: o.id,
			text: o.text,
			done: events.includes(o.done),
			...(o.optional ? { optional: true } : {})
		}));
}

/** The newcomer's first find where the party is, while it can be found. */
function firstFind(room: Room, adventure: AdventureState): AdventureView['firstFind'] {
	for (const def of content(adventure).objects) {
		if (!def.firstFind || def.location !== adventure.location) continue;
		const cells = objectCells(room, def);
		if (!cells?.length || shownState(adventure, def) !== 'interactable') continue;
		return { objectId: def.id, cells, clueId: def.firstFind };
	}
	return null;
}

const listStatuses = (statuses: Statuses) => [...statuses].map(([id, rounds]) => ({ id, rounds }));

/**
 * The adventure as `viewer` may know it. `tokenIds` are the tokens in the
 * viewer's view; `known` is the cells the viewer has seen (null: all of them).
 */
export function adventureView(
	room: Room,
	viewer: Player,
	tokenIds: ReadonlySet<string>,
	known: CellMask | null
): AdventureView | null {
	const adventure = room.adventure;
	if (!adventure) return null;
	const A = content(adventure);
	const encounter = adventure.encounter;
	// Evidence someone found alone stays theirs (and the GM's) until they share it.
	const mine = viewer.role === 'player' ? (characterOf(room, viewer.id)?.id ?? null) : null;
	const clues = [...adventure.evidence].flatMap(([id, found]) => {
		const own = mine !== null && found.by.includes(mine);
		if (!found.shared && !own && viewer.role !== 'gm') return [];
		const def = A.clues[id];
		if (!def) return [];
		return [
			{
				id,
				title: def.title,
				text: def.text,
				kind: def.kind,
				foundBy: found.by.map((c) => A.characters[c]?.name ?? c),
				shared: found.shared,
				mine: own
			}
		];
	});
	return {
		id: adventure.id,
		title: A.title,
		stage: adventure.stage,
		chapter: {
			id: adventure.chapter,
			title: A.chapters[adventure.chapter].title,
			number: chapterNumber(A, adventure.chapter),
			of: Object.keys(A.chapters).length
		},
		location: { id: adventure.location, name: A.locations[adventure.location].name },
		objectives: objectivesFor(A, adventure),
		clues,
		characters: Object.entries(A.characters).map(([id, def]) => {
			const state = adventure.characters.get(id);
			const token = state && room.tokens.get(state.tokenId);
			const maxHp = def.hp;
			return {
				id,
				inPlay: !!token,
				playerId: token?.ownerId ?? null,
				tokenId: token && tokenIds.has(token.id) ? token.id : null,
				hp: token && state ? state.hp : maxHp,
				maxHp,
				downed: !!token && !!state && state.hp <= 0 && !state.dead,
				dead: !!token && !!state && state.dead,
				downedFor: state?.downedFor ?? 0,
				statuses: token && state ? listStatuses(state.statuses) : [],
				usesLeft: Object.fromEntries(
					def.actions.map((a) => [a.id, state ? usesLeft(state, a) : a.uses])
				),
				carrying: [...adventure.carried].flatMap(([item, by]) => {
					const thing = by === id && token ? objectDef(A, item) : undefined;
					return thing ? [{ id: thing.id, name: thing.name }] : [];
				})
			};
		}),
		interactables: A.objects.flatMap((def) => {
			const state = objectState(adventure, def);
			const verbs = verbsFor(adventure, def);
			const cells = objectCells(room, def);
			if (shownState(adventure, def) === 'hidden' || verbs.length === 0 || !cells) return [];
			// What a character carries is theirs to use (and the GM's to see).
			const carrier = adventure.carried.get(def.id);
			if (carrier !== undefined) {
				if (viewer.role !== 'gm' && carrier !== mine) return [];
			} else if (known && !cells.some((c) => known[cellIndex(room.grid, c)])) return [];
			return [
				{
					id: def.id,
					name: def.name,
					kind: def.kind,
					state,
					cells,
					carried: carrier !== undefined && carrier === mine,
					verbs: verbs.map((v) => ({
						id: v.id,
						label: v.label,
						action: actionOfVerb(v),
						physical: v.physical ?? null,
						check: v.check && state !== 'used' ? { ...v.check } : null,
						tried: mine !== null && adventure.tried.has(`${mine}:${def.id}:${v.id}`),
						inFight: v.inFight === true
					}))
				}
			];
		}),
		objects:
			viewer.role === 'gm'
				? A.objects
						.filter((def) =>
							def.carry ? objectCells(room, def) !== null : def.location === adventure.location
						)
						.map((def) => ({
							id: def.id,
							name: def.name,
							kind: def.kind,
							state: objectState(adventure, def),
							states: [...def.states]
						}))
				: null,
		encounter: encounter && {
			round: encounter.round,
			order: encounter.order.map((t) => {
				if (t.kind === 'enemy') {
					const e = encounter.enemies.get(t.tokenId);
					return {
						kind: 'enemy' as const,
						characterId: null,
						name: e ? (A.enemies[e.kind]?.name ?? 'Enemy') : 'Enemy',
						initiative: t.initiative,
						tokenId: tokenIds.has(t.tokenId) ? t.tokenId : null,
						out: !e
					};
				}
				const state = adventure.characters.get(t.id);
				const token = state && room.tokens.get(state.tokenId);
				return {
					kind: 'character' as const,
					characterId: t.id,
					name: A.characters[t.id]?.name ?? t.id,
					initiative: t.initiative,
					tokenId: token && tokenIds.has(token.id) ? token.id : null,
					out: !token || !state || state.hp <= 0 || state.dead
				};
			}),
			current: encounter.current,
			counter: counterOf(adventure),
			acted: [...encounter.acted],
			moved: Object.fromEntries(encounter.moved),
			speed: encounter.speed,
			enemies: [...encounter.enemies]
				.filter(([tokenId]) => tokenIds.has(tokenId))
				.map(([tokenId, e]) => ({
					tokenId,
					name: room.tokens.get(tokenId)?.name ?? A.enemies[e.kind]?.name ?? 'Enemy',
					hp: e.hp,
					maxHp: e.maxHp,
					defense: defenseFor(A.enemies[e.kind]?.armor ?? 0),
					statuses: listStatuses(e.statuses)
				}))
		},
		decision: adventure.pending
			? {
					id: adventure.pending,
					prompt: A.decisions[adventure.pending].prompt,
					options: A.decisions[adventure.pending].options.map((o) => ({
						id: o.id,
						label: optionLabel(adventure, adventure.pending!, o)
					}))
				}
			: null,
		decisions: [...adventure.decisions].map(([id, d]) => ({
			id,
			prompt: A.decisions[id]?.prompt ?? id,
			choice: A.decisions[id]?.options.find((o) => o.id === d.option)?.label ?? d.option,
			by: d.by
		})),
		ending: endingView(A, adventure),
		ledger:
			viewer.role === 'gm'
				? {
						events: [...adventure.events],
						defeated: [...adventure.defeated],
						npcs: Object.values(A.npcs).map((npc) => ({
							id: npc.id,
							name: npc.name,
							home: npc.home,
							state: adventure.npcs.get(npc.id) ?? npc.states[0]
						})),
						encounters: [...Object.keys(A.encounters), AMBUSH].flatMap((id) => {
							const state = adventure.encounters.get(id);
							return state ? [{ id, state }] : [];
						})
					}
				: null,
		director: viewer.role === 'gm' ? directorOptions(room, adventure) : null,
		firstFind: firstFind(room, adventure),
		welcome: {
			title: `Welcome to ${A.locations[adventure.location].name}`,
			text: A.locations[adventure.location].welcome
		},
		begunAt: adventure.begunAt,
		completedAt: adventure.completedAt,
		summary: summaryOf(adventure),
		cues:
			viewer.role === 'gm'
				? A.cues.map((c) => ({ ...c, read: adventure.cuesRead.has(c.id) }))
				: null
	};
}

/** What the party did, once the story is over. */
function summaryOf(adventure: AdventureState): SessionSummary | null {
	if (adventure.stage !== 'complete' && adventure.stage !== 'defeat') return null;
	return {
		fightsWon: [...adventure.encounters.values()].filter((s) => s === 'won').length,
		foesDefeated: adventure.defeated.length,
		evidence: adventure.evidence.size,
		chapters: chapterNumber(content(adventure), adventure.chapter),
		again: [...(adventure.again ?? [])]
	};
}

/** How the story ended, if it has: the ending its deciding answer led to. */
function endingView(A: AdventureDef, adventure: AdventureState): AdventureView['ending'] {
	if (!adventure.ending) return null;
	const def = A.endings.byAnswer[endingAnswer(adventure)];
	return {
		id: adventure.ending,
		headline: def.headline,
		title: A.endings.names[adventure.ending]?.title ?? adventure.ending,
		subtitle: def.subtitle,
		text: def.text,
		scene: def.scene,
		result: def.result.map((r) => ({ ...r }))
	};
}
