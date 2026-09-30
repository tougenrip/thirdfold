// Lasting effects in a fight (a spell's Bless, a Ray of Frost's chill): kept
// on the encounter, read wherever the engine works out a defense, a speed,
// an attack or a save, and ended on time: counted on their source's turns,
// when their source loses concentration, when their bearer leaves the fight,
// and with the fight itself. Pure over the encounter; the engine logs.

import type { EffectMods, EffectSpec } from '../rules/ruleset';
import type { Encounter, LastingEffect } from './state';

type CharacterId = string;

/** Most effects in a fight at once. */
export const EFFECTS_MAX = 64;

/** The effects on a token. */
export function effectsOn(encounter: Encounter | null, tokenId: string): LastingEffect[] {
	return encounter?.effects?.filter((e) => e.target === tokenId) ?? [];
}

/** What the effects on a token come to: one blessing, defense and slows added up. */
export function modsOn(
	encounter: Encounter | null,
	tokenId: string
): Required<Pick<EffectMods, 'defense' | 'slow' | 'exposed' | 'noHealing'>> & { boon?: string } {
	const mods = { defense: 0, slow: 0, exposed: false, noHealing: false } as ReturnType<
		typeof modsOn
	>;
	for (const e of effectsOn(encounter, tokenId)) {
		if (e.mods.boon && !mods.boon) mods.boon = e.mods.boon;
		mods.defense += e.mods.defense ?? 0;
		mods.slow += e.mods.slow ?? 0;
		mods.exposed ||= !!e.mods.exposed;
		mods.noHealing ||= !!e.mods.noHealing;
	}
	return mods;
}

/**
 * Puts an effect on a token. The same spell's effect on it again replaces the
 * old one (the same spell's effects don't add up).
 */
export function addEffect(
	encounter: Encounter,
	spec: EffectSpec,
	source: CharacterId,
	target: string
): void {
	const effects = (encounter.effects ?? []).filter(
		(e) => !(e.name === spec.name && e.target === target)
	);
	if (effects.length >= EFFECTS_MAX) return;
	const n = Math.max(0, ...effects.map((e) => Number(e.id.slice(3)) || 0)) + 1;
	effects.push({
		id: `fx-${n}`,
		name: spec.name,
		source,
		target,
		mods: { ...spec.mods },
		ends: { ...spec.ends },
		concentration: spec.concentration
	});
	encounter.effects = effects;
}

/** The spell a character concentrates on in this fight, if any. */
export function concentratingOn(encounter: Encounter | null, source: CharacterId): string | null {
	return encounter?.effects?.find((e) => e.source === source && e.concentration)?.name ?? null;
}

/** A character's concentration ends: the effects of its spell go. Returns the spell's name. */
export function dropConcentration(encounter: Encounter | null, source: CharacterId): string | null {
	const name = concentratingOn(encounter, source);
	if (encounter && name)
		encounter.effects = encounter.effects!.filter((e) => !(e.source === source && e.concentration));
	return name;
}

/** Its bearer has left the fight: the effects on it go. */
export function clearOn(encounter: Encounter, tokenId: string): void {
	if (encounter.effects) encounter.effects = encounter.effects.filter((e) => e.target !== tokenId);
}

/** The next attack against a token has been made: an effect that exposed it ends. */
export function spendExposed(encounter: Encounter, tokenId: string): void {
	if (encounter.effects)
		encounter.effects = encounter.effects.filter((e) => !(e.target === tokenId && e.mods.exposed));
}

/** A character's turn starts: its effects count a turn down, and those that end at its start go. */
export function turnStarts(encounter: Encounter, source: CharacterId): LastingEffect[] {
	const ended: LastingEffect[] = [];
	for (const e of encounter.effects ?? []) if (e.source === source) e.ends.turns--;
	encounter.effects = (encounter.effects ?? []).filter((e) => {
		const over = e.source === source && e.ends.at === 'start' && e.ends.turns <= 0;
		if (over) ended.push(e);
		return !over;
	});
	return ended;
}

/** A character's turn ends: those of its effects that end at the end of this turn go. */
export function turnEnds(encounter: Encounter, source: CharacterId): LastingEffect[] {
	const ended: LastingEffect[] = [];
	encounter.effects = (encounter.effects ?? []).filter((e) => {
		const over = e.source === source && e.ends.at === 'end' && e.ends.turns <= 0;
		if (over) ended.push(e);
		return !over;
	});
	return ended;
}

/** An effect as players read it: "Bless: +1d4 to attack rolls and saves". */
export function effectLine(e: LastingEffect): string {
	const m = e.mods;
	const parts = [
		m.boon ? `+${m.boon} to attack rolls and saves` : '',
		m.defense ? `${m.defense > 0 ? '+' : ''}${m.defense} defense` : '',
		m.slow ? `${m.slow * 5} feet slower` : '',
		m.exposed ? 'the next attack against it has the upper hand' : '',
		m.noHealing ? 'can’t regain hit points' : ''
	].filter(Boolean);
	return parts.length ? `${e.name}: ${parts.join(', ')}` : e.name;
}
