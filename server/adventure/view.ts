// What each viewer is told about the adventure. Like the scene views in
// server/views.ts, this is filtered per viewer: enemies only when their token
// is in that viewer's view, things to interact with only once their cells
// have been seen, and the read-aloud passages only for the GM.

import { CHAPTER_IDS, type AdventureView } from '../../src/lib/adventure/adventure';
import { CHARACTER_IDS, CHARACTERS, defenseFor } from '../../src/lib/adventure/characters';
import { cellIndex, type CellMask } from '../../src/lib/game/visibility';
import type { Player, Room } from '../rooms';
import { CLUES, CUES, ENDINGS, OUTCOMES, TITLE, type ClueDef, type ClueId } from './content';
import { ENEMIES } from './enemies';
import {
	chapterNumber,
	characterOf,
	directorOptions,
	objectCells,
	objectState,
	bellAnswer,
	optionLabel,
	PULLS_TO_HOLD,
	shownState,
	usesLeft,
	verbsFor
} from './engine';
import { LOCATIONS } from './locations';
import { actionOfVerb, objectDef, OBJECTS } from './objects';
import type { Statuses } from './state';
import { NPC_IDS, NPCS } from './npcs';
import { CHAPTERS, DECISIONS, ENCOUNTER_IDS, objectivesFor } from './story';

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
	const encounter = adventure.encounter;
	// Evidence someone found alone stays theirs (and the GM's) until they share it.
	const mine = viewer.role === 'player' ? (characterOf(room, viewer.id)?.id ?? null) : null;
	const clues = [...adventure.evidence].flatMap(([id, found]) => {
		const own = mine !== null && found.by.includes(mine);
		if (!found.shared && !own && viewer.role !== 'gm') return [];
		const def: ClueDef = CLUES[id as ClueId];
		return [
			{
				id,
				title: def.title,
				text: def.text,
				kind: def.kind,
				foundBy: found.by.map((c) => CHARACTERS[c].name),
				shared: found.shared,
				mine: own
			}
		];
	});
	return {
		id: adventure.id,
		title: TITLE,
		stage: adventure.stage,
		chapter: {
			id: adventure.chapter,
			title: CHAPTERS[adventure.chapter].title,
			number: chapterNumber(adventure.chapter),
			of: CHAPTER_IDS.length
		},
		location: { id: adventure.location, name: LOCATIONS[adventure.location].name },
		objectives: objectivesFor(adventure.stage, adventure.chapter, adventure.events),
		clues,
		characters: CHARACTER_IDS.map((id) => {
			const state = adventure.characters.get(id);
			const token = state && room.tokens.get(state.tokenId);
			const maxHp = CHARACTERS[id].hp;
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
					CHARACTERS[id].actions.map((a) => [a.id, state ? usesLeft(state, a) : a.uses])
				),
				carrying: [...adventure.carried].flatMap(([item, by]) => {
					const def = by === id && token ? objectDef(item) : undefined;
					return def ? [{ id: def.id, name: def.name }] : [];
				})
			};
		}),
		interactables: OBJECTS.flatMap((def) => {
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
				? OBJECTS.filter((def) =>
						def.carry ? objectCells(room, def) !== null : def.location === adventure.location
					).map((def) => ({
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
						name: e ? ENEMIES[e.kind].name : 'Enemy',
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
					name: CHARACTERS[t.id].name,
					initiative: t.initiative,
					tokenId: token && tokenIds.has(token.id) ? token.id : null,
					out: !token || !state || state.hp <= 0 || state.dead
				};
			}),
			current: encounter.current,
			bell:
				encounter.finale === 'ringing' ? { pulls: encounter.pulls ?? 0, of: PULLS_TO_HOLD } : null,
			acted: [...encounter.acted],
			moved: Object.fromEntries(encounter.moved),
			speed: encounter.speed,
			enemies: [...encounter.enemies]
				.filter(([tokenId]) => tokenIds.has(tokenId))
				.map(([tokenId, e]) => ({
					tokenId,
					name: room.tokens.get(tokenId)?.name ?? ENEMIES[e.kind].name,
					hp: e.hp,
					maxHp: e.maxHp,
					defense: defenseFor(ENEMIES[e.kind].armor),
					statuses: listStatuses(e.statuses)
				}))
		},
		decision: adventure.pending && {
			id: adventure.pending,
			prompt: DECISIONS[adventure.pending].prompt,
			options: DECISIONS[adventure.pending].options.map((o) => ({
				id: o.id,
				label: optionLabel(adventure, adventure.pending!, o)
			}))
		},
		decisions: [...adventure.decisions].map(([id, d]) => ({
			id,
			prompt: DECISIONS[id].prompt,
			choice: DECISIONS[id].options.find((o) => o.id === d.option)?.label ?? d.option,
			by: d.by
		})),
		ending: adventure.ending && {
			id: adventure.ending,
			title: ENDINGS[adventure.ending].title,
			subtitle: OUTCOMES[bellAnswer(adventure)].subtitle,
			text: OUTCOMES[bellAnswer(adventure)].text,
			scene: OUTCOMES[bellAnswer(adventure)].scene,
			result: OUTCOMES[bellAnswer(adventure)].result.map((r) => ({ ...r }))
		},
		ledger:
			viewer.role === 'gm'
				? {
						events: [...adventure.events],
						defeated: [...adventure.defeated],
						npcs: NPC_IDS.map((id) => ({
							id,
							name: NPCS[id].name,
							home: NPCS[id].home,
							state: adventure.npcs.get(id) ?? NPCS[id].states[0]
						})),
						encounters: ENCOUNTER_IDS.flatMap((id) => {
							const state = adventure.encounters.get(id);
							return state ? [{ id, state }] : [];
						})
					}
				: null,
		director: viewer.role === 'gm' ? directorOptions(room, adventure) : null,
		begunAt: adventure.begunAt,
		completedAt: adventure.completedAt,
		cues:
			viewer.role === 'gm' ? CUES.map((c) => ({ ...c, read: adventure.cuesRead.has(c.id) })) : null
	};
}
