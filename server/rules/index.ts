// Every ruleset this server has, registered on import. The engine imports
// this, so a story can name any of them.

import type { AdventureDef } from '../../src/lib/adventure/define';
import { CLASSIC } from './classic';
import './dnd55e';
import { findRuleset } from './ruleset';

export { CLASSIC } from './classic';
export { DND_55E } from './dnd55e';

/** What is wrong with an adventure under the rules it names (or that it names rules this server lacks). */
export function rulesProblems(A: AdventureDef): string[] {
	const ref = A.rules ?? CLASSIC;
	const rules = findRuleset(ref);
	if (!rules) return [`rules: this server has no ruleset ${ref.id} v${ref.version}`];
	return rules.validate(A);
}
