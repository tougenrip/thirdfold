// Lasting effects: a spell's Bless, a Ray of Frost's chill, the Poisoned
// condition a monster's bite leaves, a GM's ruling. Each is on the story
// (`AdventureState.effects`), sourced (a character, an enemy's token, the GM
// or the story), on one bearer (a token), and ends at a set point: counted on
// its source's turns (at the start or the end of the last), when its bearer
// saves at the end of its own turn or takes damage, when its source's
// concentration breaks, with the fight (anything timed or held by
// concentration: time outside a fight isn't counted), or when the GM removes
// it. Only the server makes and ends them: nothing a client sends names one
// except the GM's remove, by its id.
//
// Stacking: the same effect from the same source again refreshes it
// (replaced, its time restarted); the same effect from another source is
// kept but suppressed while the first lasts (a spell's effects don't
// combine: the first applies, and the second takes over if the first ends
// first); different effects all apply, and a condition held twice is held
// once. Exhaustion is the one that counts: each new one adds a level.
//
// Pure over the story; the engine rolls the saves and logs what happens.

import type { EffectMods, EffectSpec, HeldCondition } from '../rules/ruleset';
import type { AdventureState, EffectSource, LastingEffect } from './state';

/** Most effects on the story at once. */
export const EFFECTS_MAX = 64;
/** The condition that counts levels. */
export const LEVELLED = 'exhaustion';

export type { EffectSource };

/** The id an effect's source takes its turns by (a character's id, an enemy's token), or null. */
export const turnKey = (source: EffectSource): string | null =>
	source.kind === 'character' || source.kind === 'enemy' ? source.id : null;

/** Whose turns an effect's time is counted on: its own clock (the GM's rulings: the bearer's), else its source's. */
const clockOf = (e: LastingEffect): string | null => e.clock ?? turnKey(e.source);

const all = (adventure: AdventureState) => adventure.effects ?? [];

/** The effects on a token, the suppressed ones too. */
export function effectsOn(adventure: AdventureState, tokenId: string): LastingEffect[] {
	return all(adventure).filter((e) => e.target === tokenId);
}

/** Whether an effect is suppressed: an earlier effect of the same name, from another source, is on the same bearer. */
export function suppressed(adventure: AdventureState, effect: LastingEffect): boolean {
	return all(adventure).some(
		(e) =>
			e !== effect &&
			e.target === effect.target &&
			e.name === effect.name &&
			order(e) < order(effect)
	);
}
const order = (e: LastingEffect) => Number(e.id.slice(3)) || 0;

/** The effects that apply to a token now. */
export function activeOn(adventure: AdventureState, tokenId: string): LastingEffect[] {
	return effectsOn(adventure, tokenId).filter((e) => !suppressed(adventure, e));
}

/** What the effects on a token come to: blessings and banes as one dice expression, defense and slows added up. */
export function modsOn(
	adventure: AdventureState | null,
	tokenId: string
): Required<Pick<EffectMods, 'defense' | 'slow' | 'exposed' | 'noHealing'>> & { boon?: string } {
	const mods = { defense: 0, slow: 0, exposed: false, noHealing: false } as ReturnType<
		typeof modsOn
	>;
	const boons: string[] = [];
	for (const e of adventure ? activeOn(adventure, tokenId) : []) {
		if (e.mods.boon) boons.push(e.mods.boon);
		mods.defense += e.mods.defense ?? 0;
		mods.slow += e.mods.slow ?? 0;
		mods.exposed ||= !!e.mods.exposed;
		mods.noHealing ||= !!e.mods.noHealing;
	}
	if (boons.length) mods.boon = boons.join('+').replace(/\+-/g, '-');
	return mods;
}

/** The conditions a token holds, each with its source's token (if any). */
export function conditionsOn(
	adventure: AdventureState | null,
	tokenId: string
): { id: string; source: string | null; level?: number; effect: LastingEffect }[] {
	return (adventure ? activeOn(adventure, tokenId) : []).flatMap((e) =>
		(e.mods.conditions ?? []).map((id) => ({
			id,
			source: e.sourceToken ?? null,
			...(id === LEVELLED ? { level: e.level ?? 1 } : {}),
			effect: e
		}))
	);
}

/** A token's conditions as the rules read them; `seen` says whether a source token is in the bearer's sight. */
export function heldOn(
	adventure: AdventureState | null,
	tokenId: string,
	seen: (source: string) => boolean
): HeldCondition[] {
	return conditionsOn(adventure, tokenId).map((c) => ({
		id: c.id,
		source: c.source,
		sourceSeen: !!c.source && seen(c.source),
		...(c.level !== undefined ? { level: c.level } : {})
	}));
}

/**
 * Puts an effect on a token. The same effect from the same source refreshes
 * it; Exhaustion adds a level to the one already there. Returns the effect
 * that now stands, or null when there's no room for another.
 */
export function addEffect(
	adventure: AdventureState,
	spec: EffectSpec,
	source: EffectSource,
	target: string,
	sourceToken: string | null = null,
	clock: string | null = null
): LastingEffect | null {
	const effects = all(adventure);
	const levelled = spec.mods.conditions?.includes(LEVELLED);
	if (levelled) {
		const had = effects.find((e) => e.target === target && e.mods.conditions?.includes(LEVELLED));
		if (had) {
			had.level = (had.level ?? 1) + 1;
			return had;
		}
	}
	const same = (e: LastingEffect) =>
		e.target === target && e.name === spec.name && sameSource(e.source, source);
	const kept = effects.filter((e) => !same(e));
	if (kept.length >= EFFECTS_MAX) return null;
	const n = Math.max(0, ...effects.map(order)) + 1;
	const effect: LastingEffect = {
		id: `fx-${n}`,
		name: spec.name,
		source: { ...source },
		...(sourceToken ? { sourceToken } : {}),
		...(clock ? { clock } : {}),
		target,
		mods: {
			...spec.mods,
			...(spec.mods.conditions ? { conditions: [...spec.mods.conditions] } : {})
		},
		ends: spec.ends ? { ...spec.ends } : null,
		concentration: spec.concentration,
		...(spec.repeat ? { repeat: { ...spec.repeat } } : {}),
		...(spec.worsens ? { worsens: structuredClone(spec.worsens) } : {}),
		...(spec.endsOnDamage ? { endsOnDamage: true } : {}),
		...(levelled ? { level: 1 } : {})
	};
	kept.push(effect);
	adventure.effects = kept;
	return effect;
}

const sameSource = (a: EffectSource, b: EffectSource) =>
	a.kind === b.kind && ('id' in a ? a.id : a.name) === ('id' in b ? b.id : b.name);

/** Removes effects; returns those removed. */
export function removeEffects(
	adventure: AdventureState,
	which: (e: LastingEffect) => boolean
): LastingEffect[] {
	const gone = all(adventure).filter(which);
	if (gone.length) adventure.effects = all(adventure).filter((e) => !which(e));
	return gone;
}

/** The spell a source concentrates on, if any. */
export function concentratingOn(adventure: AdventureState | null, source: string): string | null {
	return (
		(adventure ? all(adventure) : []).find((e) => e.concentration && turnKey(e.source) === source)
			?.name ?? null
	);
}

/** A source's concentration ends: the effects of its spell go. Returns the spell's name. */
export function dropConcentration(adventure: AdventureState | null, source: string): string | null {
	const name = concentratingOn(adventure, source);
	if (adventure && name)
		removeEffects(adventure, (e) => e.concentration && turnKey(e.source) === source);
	return name;
}

/** Its bearer has left the fight or the table: the effects on it, and those it sourced that end on its turns, go. */
export function clearOn(adventure: AdventureState, tokenId: string): LastingEffect[] {
	return removeEffects(
		adventure,
		(e) => e.target === tokenId || (e.source.kind === 'enemy' && e.source.id === tokenId)
	);
}

/** The next attack against a token has been made: an effect that exposed it ends. */
export function spendExposed(adventure: AdventureState, tokenId: string): void {
	removeEffects(adventure, (e) => e.target === tokenId && !!e.mods.exposed);
}

/** A source's turn starts: its effects count a turn down, and those that end at its start go. */
export function turnStarts(adventure: AdventureState, source: string): LastingEffect[] {
	for (const e of all(adventure)) if (e.ends && clockOf(e) === source) e.ends.turns--;
	return removeEffects(
		adventure,
		(e) => !!e.ends && clockOf(e) === source && e.ends.at === 'start' && e.ends.turns <= 0
	);
}

/** A source's turn ends: those of its effects that end at the end of this turn go. */
export function turnEnds(adventure: AdventureState, source: string): LastingEffect[] {
	return removeEffects(
		adventure,
		(e) => !!e.ends && clockOf(e) === source && e.ends.at === 'end' && e.ends.turns <= 0
	);
}

/** The fight is over: what is timed or held by concentration ends with it (time outside a fight isn't counted). */
export function fightEnds(adventure: AdventureState): LastingEffect[] {
	return removeEffects(
		adventure,
		(e) =>
			(!!e.ends && e.source.kind !== 'gm') ||
			e.concentration ||
			!!e.repeat ||
			e.source.kind === 'enemy'
	);
}

/** An effect as players read it: "Bless: +1d4 to attack rolls and saves". */
export function effectLine(e: LastingEffect, names: (id: string) => string = (id) => id): string {
	const m = e.mods;
	const parts = [
		m.conditions?.length
			? m.conditions
					.map((c) => (c === LEVELLED ? `${names(c)} ${e.level ?? 1}` : names(c)))
					.join(' and ')
			: '',
		m.boon
			? m.boon.startsWith('-')
				? `${m.boon.slice(1)} off attack rolls and saves`
				: `+${m.boon} to attack rolls and saves`
			: '',
		m.defense ? `${m.defense > 0 ? '+' : ''}${m.defense} defense` : '',
		m.slow ? `${m.slow * 5} feet slower` : '',
		m.exposed ? 'the next attack against it has the upper hand' : '',
		m.noHealing ? 'can’t regain hit points' : ''
	].filter(Boolean);
	return parts.length ? `${e.name}: ${parts.join(', ')}` : e.name;
}
