// A campaign's characters in a story (milestone 58; the record is
// server/campaigns.ts). An adventure started for a campaign must play by the
// campaign's rules at their exact version, with content from the same
// source; its active characters then come into the story as built
// characters under their roster ids, each restored and checked in full by
// the rules' builder, as a saved story's are.

import type { AdventureDef } from './define';
import type { BuiltCharacter } from './built';
import { BUILT_MAX } from './built';
import { compareContent } from './lock';
import type { CampaignRecord } from '../campaigns';
import { CLASSIC } from '../rules/classic';
import { findRuleset } from '../rules/ruleset';

export type CampaignParty =
	| {
			ok: true;
			built: Map<string, BuiltCharacter>;
			members: { id: string; player: string | null }[];
			/** What was checked again (content rebuilt from the same source since the campaign began). */
			notes: string[];
	  }
	| { ok: false; message: string };

/** The campaign's active characters, ready to play adventure `A`; or why they can't. */
export function campaignParty(record: CampaignRecord, A: AdventureDef): CampaignParty {
	const ref = A.rules ?? CLASSIC;
	const rules = findRuleset(record.rules);
	if (!rules?.builder)
		return { ok: false, message: 'This server no longer has the campaign’s rules.' };
	if (ref.id !== record.rules.id || ref.version !== record.rules.version) {
		const theirs = findRuleset(ref)?.name ?? ref.id;
		return {
			ok: false,
			message: `${record.name} plays by ${rules.name} v${record.rules.version}; ${A.title} by ${theirs} v${ref.version}.`
		};
	}
	const pinned = compareContent(record.content, rules.contentPins?.() ?? []);
	if (pinned.error) return { ok: false, message: pinned.error.replace('This story', record.name) };
	const active = record.roster.filter((e) => e.status === 'active');
	if (active.length > BUILT_MAX)
		return { ok: false, message: `At most ${BUILT_MAX} characters go on an adventure.` };
	const built = new Map<string, BuiltCharacter>();
	for (const entry of active) {
		if (Object.hasOwn(A.characters, entry.id))
			return { ok: false, message: `${A.title} has a character of its own named ${entry.id}.` };
		const restored = rules.builder.restore(entry.saved, entry.id);
		if (!restored.ok)
			return {
				ok: false,
				message: `${entry.id} can't come along: ${restored.problems.slice(0, 3).join('; ')}.`
			};
		built.set(entry.id, { def: restored.def, saved: restored.saved });
	}
	return {
		ok: true,
		built,
		members: active.map((e) => ({ id: e.id, player: e.player })),
		notes: pinned.notes.map((n) => n.replace('this story was saved', 'the campaign began'))
	};
}
