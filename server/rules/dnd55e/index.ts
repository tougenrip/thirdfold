// The fifth edition rules (SRD 5.2.1), as ruleset `dnd-5.5e` v1: ability
// checks, saving throws and attack rolls as d20 tests with ability
// modifiers and proficiency; advantage and disadvantage from what the table
// knows (the dark, an archer with a foe beside it, a target taking cover
// behind a guard); critical hits on a natural 20, misses on a natural 1; and
// turns with an action and a bonus action. Characters' numbers come from
// their sheets (sheet.ts); Armor Class is the definition's `armor`.
//
// Not yet here, and so not approximated: reactions (milestone 50), death
// saving throws (a downed character bleeds out as under the classic rules
// until milestone 50), spells (48), conditions (49; the table's statuses
// keep their meaning: guarded is taking cover, slowed halves speed, burning
// burns). This work includes material from the SRD 5.2.1; see core.ts.

import { summarizeAction, STATUSES } from '../../../src/lib/adventure/characters';
import { classic } from '../classic';
import { registerRuleset, testsOf, type Ruleset, type RulesetRef } from '../ruleset';
import {
	abilityModifier,
	abilityName,
	ABILITIES,
	ATTRIBUTION,
	describeD20,
	isAbility,
	modeOf,
	proficiencyBonus,
	rollD20,
	rollDamage,
	skillOf,
	SKILLS,
	type Ability
} from './core';
import { readSheet, sheetOf, type Sheet } from './sheet';

export const DND_55E: RulesetRef = { id: 'dnd-5.5e', version: 1 };

const mod = (sheet: Sheet, ability: Ability) => abilityModifier(sheet.abilities[ability]);
const prof = (sheet: Sheet) => proficiencyBonus(sheet.level);

/** What a check or save of `stat` adds for this sheet: the ability's modifier, plus proficiency. */
function bonusOf(sheet: Sheet, stat: string, kind: 'check' | 'save'): number {
	if (kind === 'save') {
		if (!isAbility(stat)) return 0;
		return mod(sheet, stat) + (sheet.saves.includes(stat) ? prof(sheet) : 0);
	}
	if (isAbility(stat)) return mod(sheet, stat);
	const skill = skillOf(stat);
	if (!skill) return 0;
	const times = sheet.expertise.includes(skill.id) ? 2 : sheet.skills.includes(skill.id) ? 1 : 0;
	return mod(sheet, skill.ability) + times * prof(sheet);
}

function labelOf(stat: string, kind: 'check' | 'save'): string {
	if (isAbility(stat))
		return kind === 'save' ? `${abilityName(stat)} saving throw` : abilityName(stat);
	const skill = skillOf(stat);
	return skill ? `${abilityName(skill.ability)} (${skill.name})` : stat;
}

export const dnd55e: Ruleset = {
	...DND_55E,
	name: 'Fifth Edition (SRD 5.2.1)',
	attribution: ATTRIBUTION,
	isStat: (stat, kind) => isAbility(stat) || (kind === 'check' && !!skillOf(stat)),
	bonus: (character, stat, kind) => bonusOf(sheetOf(character), stat, kind),
	label: labelOf,
	test(character, stat, kind, dc, situation, roller) {
		const bonus = bonusOf(sheetOf(character), stat, kind);
		const d20 = rollD20(bonus, undefined, roller);
		// In darkness a creature can't see: a check that needs sight fails (SRD: Blinded).
		const blind = kind === 'check' && situation.dark && situation.sight;
		const success = !blind && d20.total >= dc;
		const why = blind ? ': in darkness, a check that needs sight fails' : '';
		return {
			roll: d20.roll,
			success,
			label: labelOf(stat, kind),
			explain: `${describeD20(d20, bonus)} vs DC ${dc}: ${success ? 'success' : 'failure'}${why}`
		};
	},
	initiativeBonus: (character) => {
		const sheet = sheetOf(character);
		return sheet.initiative ?? mod(sheet, 'dex');
	},
	attackBonus(character, action) {
		const sheet = sheetOf(character);
		const ability = sheet.attacks[action.id];
		return ability ? mod(sheet, ability) + prof(sheet) : 0;
	},
	// Armor is the Armor Class itself.
	defense: (armor) => armor,
	strike(bonus, damage, ac, situation, roller) {
		const advantages: string[] = [];
		const disadvantages: string[] = [];
		if (situation.attackerUnseen) advantages.push('unseen attacker');
		if (situation.targetUnseen) disadvantages.push('unseen target');
		if (situation.ranged && situation.hostileBeside)
			disadvantages.push('ranged, with a foe beside');
		if (situation.targetStatuses.has('guarded')) disadvantages.push('the target is taking cover');
		const mode = modeOf(advantages, disadvantages);
		const d20 = rollD20(bonus, mode, roller);
		const critical = d20.natural === 20;
		const hit = critical || (d20.natural !== 1 && d20.total >= ac);
		const reasons = mode
			? ` [${mode}: ${(mode === 'advantage' ? advantages : disadvantages).join(', ')}]`
			: advantages.length && disadvantages.length
				? ' [advantage and disadvantage cancel]'
				: '';
		const verdict = critical
			? 'critical hit'
			: d20.natural === 1
				? 'a natural 1 misses'
				: hit
					? 'hit'
					: 'miss';
		return {
			hit,
			toHit: d20.roll,
			damage: hit ? rollDamage(damage, critical, roller) : null,
			...(critical ? { critical } : {}),
			...(mode ? { mode } : {}),
			explain: `${describeD20(d20, bonus)} vs AC ${ac}: ${verdict}${reasons}`
		};
	},
	actionType: (character, action) =>
		sheetOf(character).bonusActions.includes(action.id) ? 'bonus' : 'action',
	actionTypeName: (type) => (type === 'bonus' ? 'Bonus action' : 'Action'),
	speed: classic.speed,
	turnDamage: (statuses) =>
		statuses.has('burning') ? { dice: '1d4', cause: STATUSES.burning.name } : null,
	tick: classic.tick,
	downedTurn: classic.downedTurn,
	downedLimit: classic.downedLimit,
	card(character, statuses) {
		const sheet = sheetOf(character);
		const p = prof(sheet);
		return {
			...(sheet.title ? { title: sheet.title } : {}),
			defense: { name: 'Armor Class', value: this.defense(character.armor, statuses) },
			level: sheet.level,
			proficiency: p,
			stats: ABILITIES.map((a) => ({
				id: a.id,
				name: a.name,
				bonus: mod(sheet, a.id),
				score: sheet.abilities[a.id],
				proficient: false
			})),
			saves: ABILITIES.map((a) => ({
				id: a.id,
				name: a.name,
				bonus: bonusOf(sheet, a.id, 'save'),
				score: null,
				proficient: sheet.saves.includes(a.id)
			})),
			skills: SKILLS.map((s) => ({
				id: s.id,
				name: s.name,
				bonus: bonusOf(sheet, s.id, 'check'),
				score: null,
				proficient: sheet.skills.includes(s.id)
			})),
			actions: character.actions.map((a) => {
				const part = this.actionType(character, a);
				return {
					id: a.id,
					summary: summarizeAction(a, this.attackBonus(character, a)),
					part,
					partName: this.actionTypeName(part)
				};
			})
		};
	},
	validate(A) {
		const problems = Object.values(A.characters).flatMap((c) => {
			const read = readSheet(c);
			return read.ok ? [] : read.problems;
		});
		for (const t of testsOf(A))
			if (!this.isStat(t.stat, t.kind))
				problems.push(
					`${t.at}: no ${t.kind === 'save' ? 'saving throw' : 'ability or skill'} "${t.stat}" in the fifth edition rules`
				);
		return problems;
	}
};

registerRuleset(dnd55e);
