// What each viewer is told about the adventure. Like the scene views in
// server/views.ts, this is filtered per viewer: enemies only when their token
// is in that viewer's view, things to interact with only once their cells
// have been seen, and the read-aloud passages only for the GM.

import { lockOf } from './lock';
import {
	activeOn,
	concentratingOn,
	conditionsOn,
	effectLine,
	modsOn,
	suppressed,
	effectsOn
} from './effects';
import type {
	AdventureView,
	ConditionMark,
	Objective,
	SessionSummary
} from '../../src/lib/adventure/adventure';
import { cellIndex, type CellMask } from '../../src/lib/game/visibility';
import type { SavedScene } from '../../src/lib/game/protocol';
import type { Player, Room } from '../rooms';
import { AMBUSH, type AdventureDef } from './define';
import {
	canBuild,
	cannotRate,
	chapterNumber,
	characterOf,
	content,
	counterOf,
	directorOptions,
	endingAnswer,
	objectCells,
	objectState,
	optionLabel,
	rulesOf,
	shownState,
	usesLeft,
	verbsFor
} from './engine';
import type { AdventureState, LastingEffect, Statuses } from './state';
import { actionOfVerb, objectDef } from './world';
import { packsView } from './packs';
import { rulesInfo } from '../rules/ruleset';

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
	const me = viewer.role === 'player' ? characterOf(room, viewer.id) : null;
	const mine = me?.id ?? null;
	const rules = rulesOf(adventure);
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
			const card = rules.card(def, token && state ? state.statuses : new Map());
			const editable = viewer.role === 'gm' || (!!token && token.ownerId === viewer.id);
			// What every character can do under the rules (Dash, Dodge, …) is offered with its own actions.
			const actions = [...def.actions, ...(rules.maneuvers ?? []).map((m) => m.action)];
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
					actions.map((a) => [a.id, state ? usesLeft(state, a) : a.uses])
				),
				deathSaves:
					token && state && state.hp <= 0 && !state.dead && rules.downedDamage
						? {
								successes: state.deathSaves?.successes ?? 0,
								failures: state.deathSaves?.failures ?? 0,
								stable: !!state.deathSaves?.stable
							}
						: null,
				reaction: !rules.opportunityAttacks
					? null
					: state?.holdReaction
						? 'held'
						: encounter?.reacted?.has(id)
							? 'used'
							: 'ready',
				carrying: [...adventure.carried].flatMap(([item, by]) => {
					const thing = by === id && token ? objectDef(A, item) : undefined;
					return thing ? [{ id: thing.id, name: thing.name }] : [];
				}),
				// The rules' own data about a character (its sheet) stays on the server: the card is what the rules show.
				def: { ...def, actions, sheet: undefined },
				card,
				resourcesSpent: Object.fromEntries(
					(card.resources ?? []).map((r) => {
						const action = r.trackedBy ? def.actions.find((a) => a.id === r.trackedBy) : undefined;
						const used = action
							? (action.uses ?? 0) - ((state && usesLeft(state, action)) ?? action.uses ?? 0)
							: (state?.resources?.get(r.id) ?? 0);
						return [r.id, Math.min(r.max, Math.max(0, used))];
					})
				),
				notes: editable ? (adventure.notes?.get(id) ?? '') : null,
				editable,
				renamable: editable && !!adventure.built?.has(id) && !!rules.builder?.rename,
				effects: token ? linesOn(adventure, token.id) : [],
				conditions: token ? marksOn(room, adventure, token.id) : [],
				concentrating: concentratingOn(adventure, id),
				spent: encounter
					? [...encounter.acted].flatMap((key) => {
							if (key === id) return ['action'];
							return key.startsWith(`${id}:`) ? [key.slice(id.length + 1)] : [];
						})
					: []
			};
		}),
		piles: [...(adventure.piles ?? [])].flatMap(([id, pile]) =>
			pile.location === adventure.location &&
			room.props.has(id) &&
			(!known || known[cellIndex(room.grid, pile.pos)])
				? [
						{
							id,
							cell: { ...pile.pos },
							items: pile.items.map((item, index) => ({ index, name: item.name }))
						}
					]
				: []
		),
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
						check:
							v.check && state !== 'used'
								? {
										...v.check,
										label: rules.label(v.check.stat, v.check.save ? 'save' : 'check'),
										bonus: me
											? rules.bonus(me.def, v.check.stat, v.check.save ? 'save' : 'check')
											: null
									}
								: null,
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
			acted: [...encounter.acted].filter((key) => !key.includes(':')),
			moved: Object.fromEntries(encounter.moved),
			speed: encounter.speed,
			enemies: [...encounter.enemies]
				.filter(([tokenId]) => tokenIds.has(tokenId))
				.map(([tokenId, e]) => ({
					tokenId,
					name: room.tokens.get(tokenId)?.name ?? A.enemies[e.kind]?.name ?? 'Enemy',
					hp: e.hp,
					maxHp: e.maxHp,
					defense:
						rulesOf(adventure).defense(A.enemies[e.kind]?.armor ?? 0, e.statuses) +
						modsOn(adventure, tokenId).defense,
					statuses: listStatuses(e.statuses),
					effects: linesOn(adventure, tokenId),
					conditions: marksOn(room, adventure, tokenId)
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
		versions:
			viewer.role === 'gm'
				? {
						lock: lockOf(adventure),
						steps: (adventure.steps ?? []).map((s) => ({ ...s })),
						movable: {
							adventure: !!adventure.library && !adventure.collection,
							collection: !!adventure.collection
						}
					}
				: null,
		firstFind: firstFind(room, adventure),
		welcome: {
			title: `Welcome to ${A.locations[adventure.location].name}`,
			text: A.locations[adventure.location].welcome
		},
		begunAt: adventure.begunAt,
		completedAt: adventure.completedAt,
		summary: summaryOf(adventure),
		rewards: [...adventure.rewards],
		rules: rulesInfo(rules),
		build: canBuild(adventure) ? { rules: rules.id } : null,
		packs: packsView(adventure),
		collection: adventure.collection
			? {
					id: adventure.collection.id,
					version: adventure.collection.version,
					title: adventure.collection.title,
					creator: { ...adventure.collection.creator },
					adventures: adventure.collection.adventures.map((a, i) => ({
						title: a.title,
						playing: i === adventure.collection!.entry
					})),
					packs: adventure.collection.packs.map((p) => p.title),
					tables: adventure.collection.tables.map((t) => ({ ...t }))
				}
			: null,
		library: adventure.library
			? {
					id: adventure.library.id,
					version: adventure.library.version,
					creator: { ...adventure.library.creator },
					rated: adventure.rated?.get(viewer.id) ?? null,
					canRate: cannotRate(room, viewer) === null
				}
			: null,
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

/** A token's lasting effects beyond the conditions they give (shown as conditions), as lines; a suppressed one said so. */
function linesOn(adventure: AdventureState, tokenId: string): string[] {
	const names = conditionNames(adventure);
	const beyond = (e: LastingEffect) =>
		Object.entries(e.mods).some(([k, v]) => k !== 'conditions' && v !== undefined);
	return effectsOn(adventure, tokenId)
		.filter(beyond)
		.map(
			(e) =>
				`${effectLine(e, (id) => names.get(id)?.name ?? id)}${suppressed(adventure, e) ? ' (suppressed: the same effect already applies)' : ''}`
		);
}

function conditionNames(adventure: AdventureState) {
	return new Map((rulesOf(adventure).conditions?.list() ?? []).map((c) => [c.id, c]));
}

/** The conditions a token holds, as the table shows them. */
function marksOn(room: Room, adventure: AdventureState, tokenId: string): ConditionMark[] {
	if (!activeOn(adventure, tokenId).length) return [];
	const info = conditionNames(adventure);
	return conditionsOn(adventure, tokenId).map(({ id, level, effect }) => {
		const c = info.get(id);
		return {
			id,
			name: c?.name ?? id,
			text: c?.text ?? '',
			notPlayed: c?.notPlayed ?? [],
			...(level !== undefined ? { level } : {}),
			from:
				effect.source.kind === 'gm'
					? effect.name === c?.name
						? 'from the GM'
						: `${effect.name}, from the GM`
					: effect.name === c?.name
						? `from ${effect.source.name}`
						: `${effect.name}, from ${effect.source.name}`,
			until: untilOf(room, effect),
			effect: effect.id
		};
	});
}

/** How long an effect lasts, in words. */
function untilOf(room: Room, e: LastingEffect): string {
	const parts: string[] = [];
	if (e.repeat)
		parts.push(
			`until it saves (${e.repeat.stat.toUpperCase()} DC ${e.repeat.dc}, at the end of each of its turns)`
		);
	if (e.endsOnDamage) parts.push('until it takes damage');
	if (e.concentration) parts.push(`while ${e.source.name} concentrates`);
	if (e.ends) {
		const whose = e.clock ? clockName(room, e.clock) : e.source.name;
		parts.push(
			e.ends.turns <= 1
				? `until the ${e.ends.at} of ${whose}'s next turn`
				: `for ${e.ends.turns} more rounds`
		);
	}
	if (!parts.length)
		parts.push(e.source.kind === 'gm' ? 'until the GM removes it' : 'until it ends');
	return parts.join('; ');
}

/** Whose turns an effect counts on, by name: a character's, or an enemy's ("the Barrow Guard"). */
function clockName(room: Room, clock: string): string {
	const adventure = room.adventure!;
	const character = adventure.characters.get(clock);
	if (character) return content(adventure).characters[clock]?.name ?? clock;
	return `the ${room.tokens.get(clock)?.name ?? 'foe'}`;
}
