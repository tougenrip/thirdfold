// What an adventure file asks of its rules (milestone 57), made real on the
// server: the party its rules build from a creator's choices (`party`), the
// monsters it takes from the rules' bestiary (`monsters`), and whether its
// rests, gear, checks and saves are ones those rules have. The shared file
// reader (src/lib/adventure/file.ts) checks only their shape; the rules,
// their catalog and their bestiary live here, so this is where they are
// checked, every time a file is loaded (to play, publish, validate or read a
// save back).

import type { CharacterDef } from '../../src/lib/adventure/characters';
import {
	ADVENTURE_FILE_MAX_BYTES,
	diagnoseAdventureFile,
	ruleEffectsOf,
	type AdventureFile
} from '../../src/lib/adventure/file';
import { diagnostic, fromProblem, type Diagnostic } from '../../src/lib/validation/diagnostics';
import type { AdventureDef, EnemyDef } from './define';
import { CLASSIC, rulesProblems } from '../rules';
import { findRuleset } from '../rules/ruleset';
import type { AdventurePreview, PartyPreview } from '../../src/lib/adventure/preview';

export type RulesContent =
	{ ok: true; adventure: AdventureDef } | { ok: false; diagnostics: Diagnostic[] };

/** A file's party, monsters, rests and gear made real by its rules, and the whole checked under them. */
export function withRulesContent(file: AdventureFile, adventure: AdventureDef): RulesContent {
	const out: Diagnostic[] = [];
	const ref = file.rules ?? CLASSIC;
	const rules = findRuleset(ref);
	if (!rules)
		return {
			ok: false,
			diagnostics: [
				diagnostic('rules.unknown', 'rules', `this server doesn't have ${ref.id} v${ref.version}`)
			]
		};

	const characters: Record<string, CharacterDef> = { ...adventure.characters };
	const party = Object.entries(file.party ?? {});
	if ((party.length || file.openParty) && !rules.builder)
		out.push(diagnostic('rules.check', 'party', `${rules.name}: these rules build no characters`));
	else
		for (const [id, member] of party) {
			const built = rules.builder!.build(member.choices, id);
			if (!built.ok) {
				for (const p of built.problems) out.push(diagnostic('character.invalid', `party.${id}`, p));
				continue;
			}
			characters[id] = member.intro ? { ...built.def, intro: member.intro } : built.def;
		}

	const enemies: Record<string, EnemyDef> = { ...adventure.enemies };
	(file.monsters ?? []).forEach((kind, i) => {
		if (!rules.bestiary) {
			out.push(
				diagnostic('rules.check', `monsters[${i}]`, `${rules.name}: these rules have no bestiary`)
			);
			return;
		}
		if (Object.hasOwn(enemies, kind)) {
			out.push(
				diagnostic('ref.reserved', `monsters[${i}]`, `the file's own enemy "${kind}" has this kind`)
			);
			return;
		}
		const enemy = rules.bestiary.enemy(kind);
		if (!enemy)
			out.push(
				diagnostic('ref.missing', `monsters[${i}]`, `no monster "${kind}" the table can play`)
			);
		else enemies[kind] = enemy;
	});

	for (const e of ruleEffectsOf(file)) {
		if ('rest' in e && !rules.rests)
			out.push(diagnostic('rules.check', 'rest', `${rules.name}: these rules have no rests`));
		if ('gear' in e) {
			if (!rules.equipment)
				out.push(diagnostic('rules.check', 'gear', `${rules.name}: these rules keep no gear`));
			else if (!rules.equipment.grant(e.gear.item, e.gear.quantity).ok)
				out.push(
					diagnostic('ref.missing', 'gear', `no item "${e.gear.item}" in the rules’ catalog`)
				);
		}
	}
	if (out.length) return { ok: false, diagnostics: out };

	const made: AdventureDef = { ...adventure, characters, enemies };
	const problems = rulesProblems(made);
	if (problems.length)
		return { ok: false, diagnostics: problems.map((p) => fromProblem(p, 'rules.check')) };
	return { ok: true, adventure: made };
}

export type ServerAdventureLoad =
	| { ok: true; file: AdventureFile; adventure: AdventureDef }
	| { ok: false; error: string; diagnostics: Diagnostic[]; format: number | null };

/**
 * An adventure file read, compiled and checked in full on the server: its
 * shape and story (the shared reader), then everything its rules make of it.
 */
export function loadServerAdventure(raw: unknown, adventureId: string): ServerAdventureLoad {
	if (JSON.stringify(raw ?? null).length > ADVENTURE_FILE_MAX_BYTES)
		return {
			ok: false,
			error: 'That adventure is too large.',
			format: null,
			diagnostics: [
				diagnostic('schema.value', 'file', `at most ${ADVENTURE_FILE_MAX_BYTES / 1024} KB`)
			]
		};
	const d = diagnoseAdventureFile(raw, adventureId);
	const failed = (diagnostics: Diagnostic[]): ServerAdventureLoad => {
		const errors = diagnostics.filter((x) => x.severity === 'error');
		const first = errors[0] ?? diagnostics[0];
		return {
			ok: false,
			error:
				errors.length > 1
					? `The adventure has ${errors.length} problems: ${first.path}: ${first.message}`
					: `${first.path ? `${first.path}: ` : ''}${first.message}`,
			diagnostics,
			format: d.format
		};
	};
	if (!d.file || !d.adventure) return failed(d.diagnostics);
	if (d.diagnostics.some((x) => x.severity === 'error')) return failed(d.diagnostics);
	const made = withRulesContent(d.file, d.adventure);
	if (!made.ok) return failed(made.diagnostics);
	return { ok: true, file: d.file, adventure: made.adventure };
}

/** What a loaded adventure comes to under its rules, for the builder (milestone 57). */
export function previewOf(file: AdventureFile, adventure: AdventureDef): AdventurePreview | null {
	const ref = file.rules ?? CLASSIC;
	const rules = findRuleset(ref);
	if (!rules) return null;
	const party: PartyPreview[] = Object.entries(adventure.characters).map(([id, def]) => {
		const card = rules.card(def, new Map());
		return {
			id,
			name: def.name,
			title: card.title ?? null,
			hp: def.hp,
			defense: { ...card.defense },
			speed: def.speed
		};
	});
	return {
		rules: { id: ref.id, version: ref.version, name: rules.name },
		content: rules.contentPins?.() ?? [],
		party,
		openParty: !!file.openParty,
		monsters: (file.monsters ?? [])
			.map((kind) => rules.bestiary?.listing(kind) ?? null)
			.filter((m): m is NonNullable<typeof m> => m !== null),
		attribution: rules.attribution ?? null
	};
}
