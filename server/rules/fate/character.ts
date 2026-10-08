// A Fate Condensed character (milestone 60): a player's choices (aspects, a
// skill pyramid, bonus-granting stunts) checked here, and what they come to
// at the table. Its saved form is versioned and names the rules it was made
// for, so it is only ever restored by them; the table's `CharacterDef`
// carries the sheet the ruleset reads (sheet.ts), never a classic stat.

import type { CharacterDef, RulesData, RulesValue } from '../../../src/lib/adventure/characters';
import {
	consequenceSlots,
	FATE_ACTIONS,
	FATE_LIMITS,
	FATE_RULES,
	FATE_SKILLS,
	isFateSkill,
	PYRAMID,
	stressBoxes,
	type FateAction,
	type FateChoices,
	type FateSkill,
	type FateStunt
} from '../../../src/lib/rules/fate/core';
import type { Built, JsonData } from '../ruleset';

/** The saved form's version: a newer one is refused, an older one would be migrated here. */
export const FATE_CHARACTER_VERSION = 1;

type Raw = Record<string, unknown>;
const isObject = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);
/** Words that look like markup, a template or code: never in a character. */
const CODE = /<\s*\/?\s*[a-z!?]|javascript:|data:|\$\{|\{\{|=>|\bfunction\s*\(|\beval\s*\(/i;

export type ChoicesRead = { ok: true; choices: FateChoices } | { ok: false; problems: string[] };

/** A player's choices, read field by field: unknown fields refused, the pyramid exact. */
export function readChoices(raw: unknown): ChoicesRead {
	const problems: string[] = [];
	if (!isObject(raw)) return { ok: false, problems: ['choices: expected an object'] };
	const known = ['name', 'highConcept', 'trouble', 'aspects', 'skills', 'stunts', 'color'];
	for (const k of Object.keys(raw))
		if (!known.includes(k)) problems.push(`${k}: a field these rules don't know`);
	const text = (v: unknown, at: string, max: number): string => {
		if (typeof v !== 'string' || !v.trim() || v.length > max) {
			problems.push(`${at}: text of 1 to ${max} characters`);
			return '';
		}
		if (CODE.test(v)) problems.push(`${at}: no markup, templates or code`);
		return v.trim();
	};
	const name = text(raw.name, 'name', FATE_LIMITS.name);
	const highConcept = text(raw.highConcept, 'highConcept', FATE_LIMITS.aspect);
	const trouble = text(raw.trouble, 'trouble', FATE_LIMITS.aspect);
	const aspects: string[] = [];
	if (!Array.isArray(raw.aspects) || raw.aspects.length > FATE_LIMITS.aspects)
		problems.push(`aspects: a list of at most ${FATE_LIMITS.aspects}`);
	else raw.aspects.forEach((a, i) => aspects.push(text(a, `aspects[${i}]`, FATE_LIMITS.aspect)));

	const skills: Partial<Record<FateSkill, number>> = {};
	if (!isObject(raw.skills)) problems.push('skills: expected an object of ratings');
	else {
		const counts: Record<number, number> = {};
		for (const [k, v] of Object.entries(raw.skills)) {
			if (!isFateSkill(k)) {
				problems.push(`skills.${k}: no such skill`);
				continue;
			}
			if (!Number.isInteger(v) || (v as number) < 1 || (v as number) > 4) {
				problems.push(`skills.${k}: a rating from Average (+1) to Great (+4)`);
				continue;
			}
			skills[k] = v as number;
			counts[v as number] = (counts[v as number] ?? 0) + 1;
		}
		for (const [rating, n] of Object.entries(PYRAMID))
			if ((counts[Number(rating)] ?? 0) !== n)
				problems.push(
					`skills: exactly ${n} at +${rating} (one Great, two Good, three Fair, four Average)`
				);
	}

	const stunts: FateStunt[] = [];
	if (!Array.isArray(raw.stunts) || raw.stunts.length > FATE_LIMITS.stunts)
		problems.push(`stunts: a list of at most ${FATE_LIMITS.stunts}`);
	else
		raw.stunts.forEach((s, i) => {
			const at = `stunts[${i}]`;
			if (!isObject(s)) return void problems.push(`${at}: expected an object`);
			for (const k of Object.keys(s))
				if (!['name', 'skill', 'action', 'when'].includes(k))
					problems.push(`${at}.${k}: a field these rules don't know`);
			if (!isFateSkill(s.skill)) problems.push(`${at}.skill: no such skill`);
			if (!FATE_ACTIONS.includes(s.action as FateAction))
				problems.push(`${at}.action: one of ${FATE_ACTIONS.join(', ')}`);
			stunts.push({
				name: text(s.name, `${at}.name`, FATE_LIMITS.stuntName),
				skill: s.skill as FateSkill,
				action: s.action as FateAction,
				when: text(s.when, `${at}.when`, FATE_LIMITS.stuntWhen)
			});
		});
	const color = typeof raw.color === 'string' && /^#[0-9a-f]{6}$/i.test(raw.color) ? raw.color : '';
	if (!color) problems.push('color: a colour like #3c78b4');
	if (problems.length) return { ok: false, problems };
	return { ok: true, choices: { name, highConcept, trouble, aspects, skills, stunts, color } };
}

export const ratingOf = (skills: Partial<Record<FateSkill, number>>, skill: string): number =>
	isFateSkill(skill) ? (skills[skill] ?? 0) : 0;

/** The figure a character stands as, by its best skill. */
function figureOf(c: FateChoices): string {
	const top = FATE_SKILLS.map((s) => s.id).sort(
		(a, b) => ratingOf(c.skills, b) - ratingOf(c.skills, a)
	)[0];
	if (top === 'fight' || top === 'physique') return 'warden';
	if (top === 'shoot' || top === 'stealth' || top === 'athletics' || top === 'burglary')
		return 'veil';
	if (top === 'lore' || top === 'academics' || top === 'investigate') return 'ember';
	return 'saint';
}

/** What a character's choices come to: stress, consequences, defence. */
export function summaryOf(c: FateChoices): JsonData {
	const physique = ratingOf(c.skills, 'physique');
	return {
		name: c.name,
		highConcept: c.highConcept,
		stress: stressBoxes(physique),
		consequences: consequenceSlots(physique).map((s) => s.name),
		defend: ratingOf(c.skills, 'athletics')
	};
}

/** Look the adventure gives its own characters. */
export type Look = Partial<Pick<CharacterDef, 'intro' | 'tagline' | 'model' | 'light' | 'vision'>>;

/** Cells a character moves in a turn (a zone or so), what it sees and the lantern it carries. */
const SPEED = 5;
const VISION = 6;
const LANTERN = 2;

/** A character as the table plays it under these rules. */
export function tableCharacter(c: FateChoices, id: string, look: Look = {}): CharacterDef {
	const physique = ratingOf(c.skills, 'physique');
	const boxes = stressBoxes(physique);
	const sheet: RulesData = {
		skills: { ...c.skills } as RulesData,
		highConcept: c.highConcept,
		trouble: c.trouble,
		aspects: [...c.aspects],
		stunts: c.stunts.map((s) => ({ ...s })),
		stress: boxes,
		consequences: consequenceSlots(physique).map((s) => ({ ...s })),
		saved: savedOf(c) as unknown as RulesValue
	};
	return {
		id,
		name: c.name,
		tagline: look.tagline ?? c.highConcept,
		intro:
			look.intro ?? `${c.name} steps up: ${c.highConcept}. ${c.trouble}, and everyone can see it.`,
		color: c.color,
		// Hit points are stress boxes and one more: a hit beyond the boxes takes the character out.
		hp: boxes + 1,
		armor: ratingOf(c.skills, 'athletics'),
		speed: SPEED,
		vision: look.vision ?? VISION,
		light: look.light ?? LANTERN,
		model: look.model ?? figureOf(c),
		actions: [
			{
				id: 'fight',
				name: 'Fight',
				about: 'Attack someone beside you with Fight; they defend with Athletics.',
				kind: 'attack',
				target: 'enemy',
				range: 1,
				stat: 'fight',
				dice: '0',
				uses: null
			},
			{
				id: 'shoot',
				name: 'Shoot',
				about: 'Attack someone you can see with Shoot; they defend with Athletics.',
				kind: 'attack',
				target: 'enemy',
				range: 6,
				stat: 'shoot',
				dice: '0',
				uses: null
			}
		],
		sheet
	};
}

/** The saved form: the rules it was made for, its version and the choices. */
export function savedOf(c: FateChoices): JsonData {
	return {
		rules: { ...FATE_RULES },
		version: FATE_CHARACTER_VERSION,
		choices: {
			...c,
			aspects: [...c.aspects],
			skills: { ...c.skills },
			stunts: c.stunts.map((s) => ({ ...s }))
		} as unknown as JsonData
	};
}

/** A character built from choices. */
export function buildFate(choices: unknown, id: string, look?: Look): Built {
	const read = readChoices(choices);
	if (!read.ok) return read;
	const def = tableCharacter(read.choices, id, look);
	return { ok: true, def, saved: def.sheet!.saved as JsonData };
}

/** A saved character back: only one saved by these rules, at a version they read. */
export function restoreFate(saved: unknown, id: string, base?: CharacterDef): Built {
	if (!isObject(saved)) return { ok: false, problems: ['saved character: expected an object'] };
	const rules = saved.rules as Raw | undefined;
	if (!isObject(rules) || rules.id !== FATE_RULES.id || rules.version !== FATE_RULES.version)
		return { ok: false, problems: [`saved character: not made for ${FATE_RULES.id} v1`] };
	if (typeof saved.version !== 'number' || !Number.isInteger(saved.version))
		return { ok: false, problems: ['saved character: no version'] };
	if (saved.version > FATE_CHARACTER_VERSION)
		return {
			ok: false,
			problems: [`saved character: version ${saved.version} is newer than this server reads`]
		};
	for (const k of Object.keys(saved))
		if (!['rules', 'version', 'choices'].includes(k))
			return { ok: false, problems: [`saved character: ${k} is a field these rules don't know`] };
	const look: Look | undefined = base
		? {
				intro: base.intro,
				tagline: base.tagline,
				model: base.model,
				light: base.light,
				vision: base.vision
			}
		: undefined;
	return buildFate(saved.choices, id, look);
}
