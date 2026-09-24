// What each viewer is told about the adventure. Like the scene views in
// server/views.ts, this is filtered per viewer: enemies only when their token
// is in that viewer's view, things to interact with only once their cells
// have been seen, and the read-aloud passages only for the GM.

import type { AdventureView } from '../../src/lib/adventure/adventure';
import { CHARACTER_IDS, CHARACTERS, defenseFor } from '../../src/lib/adventure/characters';
import { cellIndex, type CellMask } from '../../src/lib/game/visibility';
import type { Player, Room } from '../rooms';
import { CLUES, CUES, HOUND, objectivesFor, SECTION, TITLE } from './content';
import { objectCells, objectState, usesLeft, verbsFor } from './engine';
import { OBJECTS } from './objects';
import type { Statuses } from './state';

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
	return {
		id: adventure.id,
		title: TITLE,
		section: SECTION,
		stage: adventure.stage,
		objectives: objectivesFor(adventure.stage),
		clues: adventure.clues.map((id) => ({ ...CLUES[id as keyof typeof CLUES] })),
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
				)
			};
		}),
		interactables: OBJECTS.flatMap((def) => {
			const state = objectState(adventure, def);
			const verbs = verbsFor(adventure, def);
			const cells = objectCells(room, def);
			if (state === 'hidden' || verbs.length === 0 || !cells) return [];
			if (known && !cells.some((c) => known[cellIndex(room.grid, c)])) return [];
			return [
				{
					id: def.id,
					name: def.name,
					kind: def.kind,
					state,
					cells,
					verbs: verbs.map((v) => ({ id: v.id, label: v.label }))
				}
			];
		}),
		objects:
			viewer.role === 'gm'
				? OBJECTS.map((def) => ({
						id: def.id,
						name: def.name,
						kind: def.kind,
						state: objectState(adventure, def),
						states: [...def.states]
					}))
				: null,
		encounter: encounter && {
			round: encounter.round,
			phase: encounter.phase,
			acted: [...encounter.acted],
			moved: Object.fromEntries(encounter.moved),
			enemies: [...encounter.enemies]
				.filter(([tokenId]) => tokenIds.has(tokenId))
				.map(([tokenId, e]) => ({
					tokenId,
					name: room.tokens.get(tokenId)?.name ?? HOUND.name,
					hp: e.hp,
					maxHp: e.maxHp,
					defense: defenseFor(HOUND.armor),
					statuses: listStatuses(e.statuses)
				}))
		},
		begunAt: adventure.begunAt,
		completedAt: adventure.completedAt,
		cues:
			viewer.role === 'gm' ? CUES.map((c) => ({ ...c, read: adventure.cuesRead.has(c.id) })) : null
	};
}
