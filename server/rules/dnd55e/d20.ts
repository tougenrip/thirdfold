// A fifth edition d20 test (an ability check or a saving throw) as the
// table resolves it: the bonus, Exhaustion's penalty, a blessing's or a
// bane's dice, the dark and the tester's conditions (a check that needs
// sight fails in the dark or Blinded; Paralyzed fails Strength and
// Dexterity saves; Poisoned checks and Restrained Dexterity saves are at
// Disadvantage), explained in a line.

import type { HeldCondition, TestResult } from '../ruleset';
import type { DieRoller } from '../../../src/lib/game/dice';
import { exhaustionPenalty, testReasons } from './conditions';
import { describeD20, isAbility, modeOf, rollD20, skillOf, type Ability } from './core';

export function d20Test(options: {
	bonus: number;
	kind: 'check' | 'save';
	stat: string;
	label: string;
	dc: number;
	held?: readonly HeldCondition[];
	boon?: string;
	/** In the dark, a check that needs sight. */
	blindHere?: boolean;
	sight?: boolean;
	advantage?: string[];
	roller: DieRoller;
}): TestResult {
	const held = options.held ?? [];
	const ability: Ability | null = isAbility(options.stat)
		? options.stat
		: (skillOf(options.stat)?.ability ?? null);
	const reasons = testReasons(held, options.kind, ability, !!options.sight);
	const penalty = exhaustionPenalty(held);
	const bonus = options.bonus - penalty;
	const advantages = options.advantage ?? [];
	const mode = modeOf(advantages, reasons.disadvantages);
	const d20 = rollD20(bonus, mode, options.roller, options.boon);
	const fail = options.blindHere ? 'in darkness, a check that needs sight fails' : reasons.fail;
	const success = !fail && d20.total >= options.dc;
	const notes = [
		mode
			? `${mode}: ${(mode === 'advantage' ? advantages : reasons.disadvantages).join(', ')}`
			: advantages.length && reasons.disadvantages.length
				? 'advantage and disadvantage cancel'
				: '',
		penalty ? `Exhaustion −${penalty}` : ''
	].filter(Boolean);
	return {
		roll: d20.roll,
		success,
		label: options.label,
		...(mode ? { mode } : {}),
		explain: `${describeD20(d20, bonus)} vs DC ${options.dc}: ${success ? 'success' : 'failure'}${fail ? `: ${fail}` : ''}${notes.length ? ` [${notes.join('; ')}]` : ''}`
	};
}
