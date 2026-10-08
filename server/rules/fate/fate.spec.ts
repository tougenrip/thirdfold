import { describe, expect, it } from 'vitest';
import type { CharacterDef } from '../../../src/lib/adventure/characters';
import type { DieRoller } from '../../../src/lib/game/dice';
import {
	FATE_ATTRIBUTION,
	FATE_PREGENS,
	FATE_RULES,
	ladder,
	outcomeOf,
	stressBoxes,
	type FateChoices
} from '../../../src/lib/rules/fate/core';
import type { CharacterState } from '../../adventure/state';
import { findRuleset } from '../ruleset';
import { buildFate, readChoices, restoreFate } from './character';
import { consequencesFor, fateCondensed } from './index';

const rules = fateCondensed;
/** Every Fate die blank (a d3's 2): rolls come to the rating alone. */
const blank: DieRoller = () => 2;
/** Faces in order, then blanks: 3 is +, 1 is −. */
const faces = (...f: number[]): DieRoller => {
	let i = 0;
	return () => f[i++] ?? 2;
};

const marshal = FATE_PREGENS[0].choices;

function built(choices: FateChoices = marshal, id = 'pc-1'): CharacterDef {
	const b = buildFate(choices, id);
	if (!b.ok) throw new Error(b.problems.join('; '));
	return b.def;
}

const state = (def: CharacterDef, hp = def.hp): CharacterState => ({
	tokenId: 't',
	hp,
	statuses: new Map(),
	uses: new Map(),
	downedFor: 0,
	dead: false
});

const open = {
	ranged: false,
	hostileBeside: false,
	targetUnseen: false,
	attackerUnseen: false,
	targetStatuses: new Map()
};

describe('the ladder and outcomes', () => {
	it('names ratings as Fate does', () => {
		expect(ladder(3)).toBe('Good (+3)');
		expect(ladder(0)).toBe('Mediocre (+0)');
		expect(ladder(-2)).toBe('Terrible (−2)');
		expect(ladder(9)).toBe('Beyond Legendary (+9)');
	});

	it('reads shifts as fail, tie, success and success with style', () => {
		expect([-1, 0, 1, 2, 3].map(outcomeOf)).toEqual(['fail', 'tie', 'success', 'success', 'style']);
	});

	it('gives stress boxes by Physique', () => {
		expect([0, 1, 2, 3, 4, 5].map(stressBoxes)).toEqual([3, 4, 4, 6, 6, 6]);
	});
});

describe('Fate Condensed characters', () => {
	it('builds every ready-made character', () => {
		for (const p of FATE_PREGENS) expect(readChoices(p.choices).ok).toBe(true);
	});

	it('plays a character from its choices: no classic stats, stress as hit points', () => {
		const def = built();
		expect(def.stats).toBeUndefined();
		// Physique Fair (+2): four boxes, and one more before being taken out.
		expect(def.hp).toBe(5);
		expect(def.armor).toBe(3);
		expect(def.actions.map((a) => [a.id, a.stat])).toEqual([
			['fight', 'fight'],
			['shoot', 'shoot']
		]);
	});

	it('refuses choices off the pyramid, unknown fields and code', () => {
		const offPyramid = readChoices({ ...marshal, skills: { ...marshal.skills, lore: 4 } });
		expect(!offPyramid.ok && offPyramid.problems.join()).toMatch(/exactly 1 at \+4/);
		const unknown = readChoices({ ...marshal, level: 3 });
		expect(!unknown.ok && unknown.problems).toContain("level: a field these rules don't know");
		const script = readChoices({ ...marshal, trouble: '<script>x</script>' });
		expect(script.ok).toBe(false);
		const stunt = readChoices({
			...marshal,
			stunts: [{ name: 'X', skill: 'might', action: 'attack', when: 'always' }]
		});
		expect(!stunt.ok && stunt.problems.join()).toMatch(/no such skill/);
	});

	it('restores only what these rules saved, at a version they read', () => {
		const b = buildFate(marshal, 'pc-1');
		if (!b.ok) throw new Error();
		const back = restoreFate(JSON.parse(JSON.stringify(b.saved)), 'pc-1');
		expect(back.ok && back.def).toEqual(b.def);
		expect(restoreFate({ ...b.saved, rules: { id: 'dnd-5.5e', version: 1 } }, 'pc-1').ok).toBe(
			false
		);
		const newer = restoreFate({ ...b.saved, version: 2 }, 'pc-1');
		expect(!newer.ok && newer.problems[0]).toMatch(/newer/);
	});

	it('is registered, with the SRD’s credit', () => {
		expect(findRuleset(FATE_RULES)).toBe(fateCondensed);
		expect(rules.attribution).toBe(FATE_ATTRIBUTION);
		expect(FATE_ATTRIBUTION).toMatch(/Creative Commons Attribution 3\.0 Unported/);
	});
});

describe('Fate Condensed rolls', () => {
	const def = built();

	it('overcomes with four Fate dice and a skill; a tie succeeds at a minor cost', () => {
		const notice = rules.test(def, 'notice', 'check', 3, { dark: false, sight: true }, blank);
		expect(notice.roll.expression).toBe('4dF+3');
		expect(notice.success).toBe(true);
		expect(notice.explain).toMatch(
			/Good \(\+3\) against Good \(\+3\), tie \(success at a minor cost\)/
		);
		const fail = rules.test(def, 'lore', 'check', 2, { dark: false, sight: true }, faces(1, 1));
		expect(fail.success).toBe(false);
		expect(fail.roll.total).toBe(-1);
	});

	it('has no saving throws and no classic stats', () => {
		expect(rules.isStat('notice', 'check')).toBe(true);
		expect(rules.isStat('notice', 'save')).toBe(false);
		expect(rules.isStat('might', 'check')).toBe(false);
	});

	it('adds a stunt’s +2 where it applies', () => {
		// Shield Wall: +2 to Fight to defend; the defence is Athletics, so it doesn't apply there.
		expect(rules.defense(def.armor, new Map(), def)).toBe(3);
		expect(rules.attackBonus(def, def.actions[0])).toBe(4);
	});

	it('lets the defender roll: a hit is the shifts the attack beats the defence by', () => {
		// Attack: + + + 0 (+3) on Great (+4) = +7; defence blank on Fair (+2).
		const hit = rules.strike(4, '0', 2, open, faces(3, 3, 3, 2));
		expect(hit).toMatchObject({ hit: true, defense: 2 });
		expect(hit.toHit.total).toBe(7);
		expect(hit.damage!.total).toBe(5);
		expect(hit.explain).toMatch(/a 5-shift hit, with style/);
		const tie = rules.strike(2, '0', 2, open, blank);
		expect(tie.hit).toBe(false);
		expect(tie.explain).toMatch(/tie/);
	});

	it('counts an opening as a free invoke and full defense as +2', () => {
		expect(rules.strike(2, '0', 2, { ...open, exposed: true }, blank).damage!.total).toBe(2);
		expect(rules.strike(2, '0', 0, { ...open, evading: true }, blank).hit).toBe(false);
	});

	it('adds a weapon rating to a hit', () => {
		expect(rules.strike(3, '2', 2, open, blank).damage!.total).toBe(3);
	});
});

describe('stress and consequences', () => {
	it('soaks with stress first, then the least consequence that covers the rest', () => {
		const slots = [
			{ id: 'mild', absorbs: 2 },
			{ id: 'moderate', absorbs: 4 },
			{ id: 'severe', absorbs: 6 }
		];
		expect(consequencesFor(3, 2, slots)).toEqual({ ids: [], absorbs: 0 });
		expect(consequencesFor(1, 5, slots)).toEqual({ ids: ['moderate'], absorbs: 4 });
		expect(consequencesFor(0, 7, slots)).toEqual({ ids: ['mild', 'severe'], absorbs: 8 });
		expect(consequencesFor(0, 13, slots)).toBeNull();
	});

	it('marks a consequence on the character and keeps it after the fight', () => {
		const def = built();
		const s = state(def, 2); // one box left
		const soaked = rules.absorb!(s, def, 3);
		expect(soaked).toEqual({ amount: 1, note: 'takes a mild consequence and marks 1 stress.' });
		expect(s.resources?.get('mild')).toBe(1);
		s.hp -= soaked.amount;
		expect(rules.health!(s, def)).toEqual({ name: 'Stress boxes clear', value: 0, max: 4 });
		expect(rules.conflictEnds!(s, def)).toBe('stress clears.');
		expect(s.hp).toBe(def.hp);
		expect(s.resources?.get('mild')).toBe(1);
	});

	it('takes the character out when nothing can soak the hit, and nobody dies of it', () => {
		const def = built();
		const s = state(def, 1);
		for (const id of ['mild', 'moderate', 'severe']) (s.resources ??= new Map()).set(id, 1);
		const soaked = rules.absorb!(s, def, 1);
		expect(soaked.amount).toBe(1);
		expect(soaked.note).toMatch(/taken out/);
		expect(rules.downedTurn({ ...s, hp: 0 }, blank)).toMatchObject({ dead: false, stable: true });
	});

	it('shows consequences as resources and aspects and stunts as traits', () => {
		const card = rules.card(built(), new Map());
		expect(card.resources?.map((r) => r.id)).toEqual(['mild', 'moderate', 'severe']);
		expect(card.traits?.map((t) => t.kind)).toEqual([
			'High concept',
			'Trouble',
			'Aspect',
			'Stunt',
			'Stress'
		]);
		expect(card.defense).toEqual({ name: 'Defend (Athletics)', value: 3 });
		expect(card.stats[0]).toMatchObject({ id: 'fight', bonus: 4 });
		expect(card.saves).toEqual([]);
	});
});
