// The fifth edition rules' part of campaigns (milestone 58; ruleset.ts
// `Progression`): a character carried between adventures by its saved form.
// Between adventures it rests in full (the SRD's Long Rest: all Hit Points
// and Hit Point Dice back, every feature recharged). It advances a level by
// milestone where the rules need no choice from its player: level 2 needs
// none, and level 3's subclass is the SRD's only one for the class, so it is
// taken; beyond that (a feat at level 4, more Weapon Masteries) the rules
// say what is wanted and the character stays where it is. Every result is
// read back by readCharacter, so nothing is carried that the rules refuse.

import type { CharacterDef } from '../../../../src/lib/adventure/characters';
import type { JsonData, Progression, RulesetRef } from '../../ruleset';
import type { Catalog } from '../catalog';
import { sheetOf } from '../sheet';
import { deriveCharacter } from './derive';
import type { DndCharacter } from './model';
import { MAX_LEVEL } from '../core';
import { readCharacter } from './validate';

const isObject = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

export function dndProgression(catalog: () => Catalog, rules: RulesetRef): Progression {
	/** A saved form (`{ color, character }`) read in full. */
	function read(saved: JsonData): { character: DndCharacter; color: string } | null {
		if (!isObject(saved) || typeof saved.color !== 'string') return null;
		const r = readCharacter(saved.character, catalog(), rules);
		return r.ok ? { character: r.character, color: saved.color } : null;
	}
	const pack = (character: DndCharacter, color: string): JsonData =>
		JSON.parse(JSON.stringify({ color, character })) as JsonData;

	/** Rested in full: the state of a character fresh from a Long Rest. */
	function rested(c: DndCharacter): DndCharacter {
		const max = deriveCharacter(c, catalog()).hitPoints.max;
		return {
			...c,
			state: { ...c.state, hp: max, tempHp: 0, hitDiceSpent: 0, spent: {}, expended: {} }
		};
	}

	return {
		savedOf(def: CharacterDef) {
			if (!def.sheet) return null;
			try {
				const saved = sheetOf(def).saved;
				return saved && read(saved as JsonData)
					? (JSON.parse(JSON.stringify(saved)) as JsonData)
					: null;
			} catch {
				return null;
			}
		},
		describe(saved) {
			const r = read(saved);
			if (!r) return null;
			const d = deriveCharacter(r.character, catalog());
			return {
				id: r.character.id,
				name: r.character.name,
				level: r.character.level,
				title: d.title
			};
		},
		recover(saved) {
			const r = read(saved);
			return r ? pack(rested(r.character), r.color) : null;
		},
		advance(saved) {
			const r = read(saved);
			if (!r) return { ok: false, problems: ['the character no longer reads'] };
			const c = r.character;
			if (c.level >= MAX_LEVEL)
				return { ok: false, problems: [`${c.name} is at the highest level`] };
			const level = c.level + 1;
			let subclass = c.class.subclass;
			if (level >= 3 && !subclass) {
				const klass = catalog().get('class', c.class.id);
				const offered = catalog()
					.all('subclass')
					.filter((s) => (s.data as { class: string }).class === klass?.name);
				if (offered.length === 1) subclass = offered[0].id;
			}
			const next = { ...c, level, class: { ...c.class, subclass } };
			const checked = readCharacter(JSON.parse(JSON.stringify(next)), catalog(), rules);
			if (!checked.ok) return { ok: false, problems: checked.problems };
			const d = deriveCharacter(checked.character, catalog());
			return {
				ok: true,
				level,
				saved: pack(rested(checked.character), r.color),
				text: `${c.name} reaches level ${level}${subclass && !c.class.subclass ? ` (${catalog().get('subclass', subclass)?.name})` : ''}: ${d.title}.`
			};
		},
		withId(saved, id) {
			const r = read(saved);
			if (!r) return null;
			const moved = readCharacter(
				{ ...JSON.parse(JSON.stringify(r.character)), id },
				catalog(),
				rules
			);
			return moved.ok ? pack(moved.character, r.color) : null;
		}
	};
}
