// The fifth edition rules (SRD 5.2.1), as ruleset `dnd-5.5e` v1: ability
// checks, saving throws and attack rolls as d20 tests with ability
// modifiers and proficiency; advantage and disadvantage from what the table
// knows (the dark, an archer with a foe beside it, a target taking cover
// behind a guard); critical hits on a natural 20, misses on a natural 1; and
// turns with an action and a bonus action. Characters' numbers come from
// their sheets (sheet.ts); Armor Class is the definition's `armor`.
//
// Combat beyond the roll (combat.ts): death saving throws, massive damage,
// damage types against Resistance, Vulnerability and Immunity, cover, the
// Opportunity Attack as every creature's reaction, and Dash, Disengage, Dodge
// and Help. Conditions are conditions.ts; the table's older statuses keep
// their meaning (guarded is taking cover, slowed halves speed, burning
// burns). Spells are cast by spells/cast.ts. Reactions beyond the
// Opportunity Attack (a Shield spell) are not played yet, and not
// approximated. This work includes material from the SRD 5.2.1; see core.ts.

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
import { srdCatalog } from './catalog';
import { dndBuilder } from './character/builder';
import { dndPacks } from './homebrew';
import { dndEquipment } from './character/equipment';
import { dndRests } from './rests';
import { dndProgression } from './character/progression';
import { readSheet, sheetOf, type Sheet } from './sheet';
import { dndSpells } from './spells/cast';
import { attackReasons, conditionDef, dndConditions, exhaustionPenalty } from './conditions';
import { d20Test } from './d20';
import {
	coverBonus,
	damageTaken,
	damageTraits,
	deathSave,
	DOWNED_LIMIT,
	downedDamage,
	MANEUVERS,
	stabilize
} from './combat';
import { DAMAGE_TYPES } from './sheet';
import { srdBestiary } from './monsters';
import type { TestSituation } from '../ruleset';

/** What a save gains from where the saver stands: cover and a Dodge help Dexterity saves. */
function saveHelps(stat: string, situation: TestSituation): { bonus: number; advantage: string[] } {
	if (stat !== 'dex') return { bonus: 0, advantage: [] };
	const cover = situation.cover ? coverBonus(situation.cover) : null;
	return {
		bonus: cover?.bonus ?? 0,
		advantage: situation.evading ? ['dodging'] : []
	};
}

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
		const helps = kind === 'save' ? saveHelps(stat, situation) : { bonus: 0, advantage: [] };
		return d20Test({
			bonus: bonusOf(sheetOf(character), stat, kind) + helps.bonus,
			kind,
			stat,
			label: labelOf(stat, kind),
			dc,
			held: situation.conditions,
			// Bless adds its die to saving throws (not to ability checks); Bane takes one away.
			boon: kind === 'save' ? situation.boon : undefined,
			// In darkness a creature can't see: a check that needs sight fails (SRD: Blinded).
			blindHere: kind === 'check' && situation.dark && situation.sight,
			sight: situation.sight,
			advantage: [...(situation.advantage ? [situation.advantage] : []), ...helps.advantage],
			roller
		});
	},
	initiative: classic.initiative,
	initiativeBonus: (character) => {
		const sheet = sheetOf(character);
		return sheet.initiative ?? mod(sheet, 'dex');
	},
	attackBonus(character, action) {
		const sheet = sheetOf(character);
		const ability = sheet.attacks[action.id];
		if (!ability) return 0;
		// Weapon Proficiency: only a weapon the character is trained with adds the Proficiency Bonus.
		return mod(sheet, ability) + (sheet.unproficient.includes(action.id) ? 0 : prof(sheet));
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
		if (situation.exposed) advantages.push('the target is exposed');
		// Dodge: attacks against it have Disadvantage if it can see the attacker.
		if (situation.evading && !situation.attackerUnseen) disadvantages.push('the target is dodging');
		const cover = situation.cover ? coverBonus(situation.cover) : null;
		if (cover) ac += cover.bonus;
		const byConditions = attackReasons(
			situation.attackerConditions ?? [],
			situation.targetConditions ?? [],
			!!situation.within5,
			situation.targetToken ?? null
		);
		advantages.push(...byConditions.advantages);
		disadvantages.push(...byConditions.disadvantages);
		// Exhaustion takes 2 a level off every d20 test, attack rolls too.
		const penalty = exhaustionPenalty(situation.attackerConditions ?? []);
		bonus -= penalty;
		const mode = modeOf(advantages, disadvantages);
		const d20 = rollD20(bonus, mode, roller, situation.boon);
		const critical =
			d20.natural === 20 || (byConditions.autoCrit && d20.natural !== 1 && d20.total >= ac);
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
			...(cover ? { defense: ac } : {}),
			explain: `${describeD20(d20, bonus)} vs AC ${ac}${cover ? ` (+${cover.bonus}, ${cover.name})` : ''}: ${verdict}${reasons}`
		};
	},
	actionType: (character, action) =>
		sheetOf(character).bonusActions.includes(action.id) ? 'bonus' : 'action',
	actionTypeName: (type) => (type === 'bonus' ? 'Bonus action' : 'Action'),
	speed: classic.speed,
	turnDamage: (statuses) =>
		statuses.has('burning') ? { dice: '1d4', cause: STATUSES.burning.name, type: 'fire' } : null,
	tick: classic.tick,
	downedTurn: deathSave,
	downedLimit: DOWNED_LIMIT,
	downedDamage,
	stabilize,
	damageTaken,
	damageTraits,
	coverBonus,
	opportunityAttacks: true,
	rollDamage,
	bestiary: srdBestiary(srdCatalog),
	packs: dndPacks(srdCatalog),
	contentPins() {
		const c = srdCatalog();
		return [
			{
				id: c.pin.source,
				name: c.source.title,
				version: c.pin.version,
				sha256: c.pin.sha256,
				build: c.build
			}
		];
	},
	maneuvers: MANEUVERS,
	card(character, statuses) {
		const sheet = sheetOf(character);
		const p = prof(sheet);
		return {
			...(sheet.title ? { title: sheet.title } : {}),
			...(sheet.resources.length ? { resources: sheet.resources.map((r) => ({ ...r })) } : {}),
			...(sheet.details ? { details: DND_55E.id } : {}),
			...(sheet.inventory ? { inventory: sheet.inventory.map((i) => ({ ...i })) } : {}),
			...(sheet.carrying ? { carrying: { ...sheet.carrying } } : {}),
			...(sheet.resistances.length ? { resistances: [...sheet.resistances] } : {}),
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
			actions: [...character.actions, ...MANEUVERS.map((m) => m.action)].map((a) => {
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
		const own = new Set(MANEUVERS.map((m) => m.action.id));
		for (const c of Object.values(A.characters))
			for (const a of c.actions)
				if (own.has(a.id))
					problems.push(`character ${c.id}: "${a.id}" is an action every character has`);
		for (const e of Object.values(A.enemies)) {
			for (const t of [
				...(e.damage?.immune ?? []),
				...(e.damage?.resist ?? []),
				...(e.damage?.vulnerable ?? []),
				...e.attacks.flatMap((a) => (a.damageType ? [a.damageType] : []))
			])
				if (!DAMAGE_TYPES.includes(t)) problems.push(`enemy ${e.kind}: no damage type "${t}"`);
			for (const stat of Object.keys(e.saves ?? {}))
				if (!isAbility(stat)) problems.push(`enemy ${e.kind}: no saving throw "${stat}"`);
			for (const c of [
				...(e.immune ?? []),
				...e.attacks.flatMap((a) => a.inflicts?.conditions ?? [])
			])
				if (!conditionDef(c)) problems.push(`enemy ${e.kind}: no condition "${c}"`);
		}
		for (const t of testsOf(A))
			if (!this.isStat(t.stat, t.kind))
				problems.push(
					`${t.at}: no ${t.kind === 'save' ? 'saving throw' : 'ability or skill'} "${t.stat}" in the fifth edition rules`
				);
		return problems;
	},
	details: (character) => sheetOf(character).details,
	builder: dndBuilder(srdCatalog, DND_55E, ATTRIBUTION),
	equipment: dndEquipment(srdCatalog, DND_55E),
	rests: dndRests(srdCatalog, DND_55E),
	progression: dndProgression(srdCatalog, DND_55E),
	spells: dndSpells(srdCatalog, () => dnd55e.strike),
	conditions: dndConditions(srdCatalog),
	saveWith: (bonus, stat, dc, situation, roller, advantage) => {
		const helps = saveHelps(stat, situation);
		return d20Test({
			bonus: bonus + helps.bonus,
			kind: 'save',
			stat,
			label: labelOf(stat, 'save'),
			dc,
			held: situation.conditions,
			boon: situation.boon,
			advantage: [...(advantage ? [advantage] : []), ...helps.advantage],
			roller
		});
	}
};

registerRuleset(dnd55e);
