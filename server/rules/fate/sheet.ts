// A Fate Condensed character's sheet, read from the rules-neutral data on its
// definition (`CharacterDef.sheet`, written by character.ts) and checked:
//
//   sheet: {
//     skills: { fight: 4, athletics: 3, … },        // rated skills; the rest Mediocre (+0)
//     highConcept: 'Lantern-Bearing Marshal of the Fens',
//     trouble: 'Owes the Ferryman a Favour',
//     aspects: ['My Sister Keeps the Light at Hob’s End'],
//     stunts: [{ name, skill, action, when }],      // +2 to that skill for that action
//     stress: 4,                                    // physical stress boxes
//     consequences: [{ id: 'mild', name, absorbs: 2 }, …],
//     saved: { … },                                 // the character as saved (character.ts)
//   }
//
// The definition's `hp` is the stress boxes and one more (a hit beyond them
// takes the character out), its `armor` its Athletics.

import type { CharacterDef, RulesValue } from '../../../src/lib/adventure/characters';
import {
	FATE_ACTIONS,
	isFateSkill,
	type FateAction,
	type FateSkill,
	type FateStunt
} from '../../../src/lib/rules/fate/core';

export interface FateSheet {
	skills: Partial<Record<FateSkill, number>>;
	highConcept: string;
	trouble: string;
	aspects: string[];
	stunts: FateStunt[];
	stress: number;
	consequences: { id: string; name: string; absorbs: number }[];
}

const isRecord = (v: RulesValue | undefined): v is Record<string, RulesValue> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

/** A character's sheet, or what is wrong with it. */
export function readSheet(def: CharacterDef): { sheet: FateSheet } | { problem: string } {
	const raw = def.sheet;
	const bad = (what: string) => ({ problem: `character ${def.id}: ${what}` });
	if (!raw) return bad('no Fate sheet (build it from choices)');
	const skills: Partial<Record<FateSkill, number>> = {};
	if (!isRecord(raw.skills)) return bad('no skills');
	for (const [k, v] of Object.entries(raw.skills)) {
		if (!isFateSkill(k) || typeof v !== 'number' || !Number.isInteger(v) || v < -4 || v > 8)
			return bad(`skill ${k} isn't a rating`);
		skills[k] = v;
	}
	const text = (v: RulesValue | undefined) => (typeof v === 'string' ? v : null);
	const highConcept = text(raw.highConcept);
	const trouble = text(raw.trouble);
	if (!highConcept || !trouble) return bad('no high concept or trouble');
	if (!Array.isArray(raw.aspects) || raw.aspects.some((a) => typeof a !== 'string'))
		return bad('aspects must be text');
	const stunts: FateStunt[] = [];
	if (!Array.isArray(raw.stunts)) return bad('no stunts list');
	for (const s of raw.stunts) {
		if (
			!isRecord(s) ||
			!isFateSkill(s.skill) ||
			!FATE_ACTIONS.includes(s.action as FateAction) ||
			typeof s.name !== 'string' ||
			typeof s.when !== 'string'
		)
			return bad('a stunt is malformed');
		stunts.push({
			name: s.name,
			skill: s.skill,
			action: s.action as FateAction,
			when: s.when
		});
	}
	const stress = raw.stress;
	if (typeof stress !== 'number' || !Number.isInteger(stress) || stress < 0 || stress > 12)
		return bad('stress boxes must be 0 to 12');
	if (def.hp !== stress + 1) return bad('hit points must be its stress boxes and one more');
	const consequences: FateSheet['consequences'] = [];
	if (!Array.isArray(raw.consequences)) return bad('no consequence slots');
	for (const c of raw.consequences) {
		if (
			!isRecord(c) ||
			typeof c.id !== 'string' ||
			typeof c.name !== 'string' ||
			typeof c.absorbs !== 'number'
		)
			return bad('a consequence slot is malformed');
		consequences.push({ id: c.id, name: c.name, absorbs: c.absorbs });
	}
	return {
		sheet: {
			skills,
			highConcept,
			trouble,
			aspects: raw.aspects as string[],
			stunts,
			stress,
			consequences
		}
	};
}

const cache = new WeakMap<CharacterDef, FateSheet>();

/** A character's sheet (checked once by `validate`); a blank one for a character without. */
export function sheetOf(def: CharacterDef): FateSheet {
	const hit = cache.get(def);
	if (hit) return hit;
	const read = readSheet(def);
	const sheet =
		'sheet' in read
			? read.sheet
			: {
					skills: {},
					highConcept: def.tagline,
					trouble: '',
					aspects: [],
					stunts: [],
					stress: Math.max(0, def.hp - 1),
					consequences: []
				};
	cache.set(def, sheet);
	return sheet;
}

/** A skill's rating, with +2 for each stunt that names it for this action. */
export function ratingFor(sheet: FateSheet, skill: string, action: FateAction): number {
	const base = isFateSkill(skill) ? (sheet.skills[skill] ?? 0) : 0;
	return base + 2 * sheet.stunts.filter((s) => s.skill === skill && s.action === action).length;
}

/** The stunts that add to a skill for an action, by name. */
export const stuntsFor = (sheet: FateSheet, skill: string, action: FateAction): string[] =>
	sheet.stunts.filter((s) => s.skill === skill && s.action === action).map((s) => s.name);
