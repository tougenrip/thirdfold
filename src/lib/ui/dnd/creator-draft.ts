// The fifth edition character creator's draft: the choices made so far and
// the step the player is on, kept in the browser per room so a creation
// left half-way (a refresh, a dropped connection) picks up where it was.
// The steps here only guide (what is left to choose on each, in plain
// words); the server checks the finished choices and works out every number.

import type {
	AbilityId,
	CreatorChoices,
	CreatorOptions,
	ScoreMethod
} from '../../rules/dnd55e/creator';

export const STEPS = [
	{ id: 'class', title: 'Class' },
	{ id: 'origin', title: 'Origin' },
	{ id: 'abilities', title: 'Abilities' },
	{ id: 'skills', title: 'Skills' },
	{ id: 'spells', title: 'Spells' },
	{ id: 'gear', title: 'Gear' },
	{ id: 'review', title: 'Name & review' }
] as const;
export type StepId = (typeof STEPS)[number]['id'];

export const ABILITY_IDS: readonly AbilityId[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

export interface Draft {
	step: StepId;
	name: string;
	color: string;
	classId: string | null;
	speciesId: string | null;
	speciesOptions: Record<string, string>;
	speciesFeat: string | null;
	speciesFeatSkills: string[];
	backgroundId: string | null;
	/** Which background increase: +2/+1 or +1/+1/+1. */
	increaseMode: 'two' | 'three';
	/** For +2/+1: the ability raised by 2 and the one by 1. */
	plusTwo: AbilityId | null;
	plusOne: AbilityId | null;
	method: ScoreMethod;
	/** Base scores; for the standard array, null until a value is placed. */
	base: Record<AbilityId, number | null>;
	skills: string[];
	expertise: string[];
	fightingStyle: string | null;
	masteries: string[];
	armor: string | null;
	shield: boolean;
	weapons: string[];
	/** A caster's cantrips and prepared spells. */
	cantrips: string[];
	prepared: string[];
}

export function emptyDraft(): Draft {
	return {
		step: 'class',
		name: '',
		color: '',
		classId: null,
		speciesId: null,
		speciesOptions: {},
		speciesFeat: null,
		speciesFeatSkills: [],
		backgroundId: null,
		increaseMode: 'two',
		plusTwo: null,
		plusOne: null,
		method: 'standard-array',
		base: { str: null, dex: null, con: null, int: null, wis: null, cha: null },
		skills: [],
		expertise: [],
		fightingStyle: null,
		masteries: [],
		armor: null,
		shield: false,
		weapons: [],
		cantrips: [],
		prepared: []
	};
}

/** Point buy's starting scores: all 8s, nothing spent. */
export function pointBuyBase(): Record<AbilityId, number> {
	return { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 };
}

/** Points spent on a point-buy spread (unknown scores count as nothing). */
export function pointsSpent(draft: Draft, options: CreatorOptions): number {
	return ABILITY_IDS.reduce((sum, a) => {
		const score = draft.base[a];
		return sum + (score === null ? 0 : (options.pointCost[String(score)] ?? 0));
	}, 0);
}

/** The standard array's values not yet placed. */
export function unplaced(draft: Draft, options: CreatorOptions): number[] {
	const left = [...options.standardArray];
	for (const a of ABILITY_IDS) {
		const at = left.indexOf(draft.base[a] ?? -1);
		if (at >= 0) left.splice(at, 1);
	}
	return left;
}

/** Skills the character has from its background and species options, before the class's choices. */
export function originSkills(draft: Draft, options: CreatorOptions): string[] {
	const background = options.backgrounds.find((b) => b.id === draft.backgroundId);
	const species = options.species.find((s) => s.id === draft.speciesId);
	const fromSpecies = (species?.options ?? [])
		.filter((o) => o.kind === 'skill' && draft.speciesOptions[o.key])
		.map((o) => draft.speciesOptions[o.key]);
	return [...(background?.skills ?? []), ...fromSpecies, ...draft.speciesFeatSkills];
}

/** What is left to choose on a step, in plain words; empty when the step is done. */
export function todo(draft: Draft, options: CreatorOptions, step: StepId): string[] {
	const klass = options.classes.find((c) => c.id === draft.classId);
	const species = options.species.find((s) => s.id === draft.speciesId);
	const background = options.backgrounds.find((b) => b.id === draft.backgroundId);
	const out: string[] = [];
	switch (step) {
		case 'class':
			if (!klass) out.push('Choose a class.');
			break;
		case 'origin': {
			if (!species) out.push('Choose a species.');
			for (const o of species?.options ?? [])
				if (!draft.speciesOptions[o.key])
					out.push(
						o.kind === 'skill'
							? `Choose a skill for ${o.label}.`
							: `Choose your ${o.label.toLowerCase()}.`
					);
			if (species?.feat && !draft.speciesFeat) out.push('Choose an Origin feat.');
			const feat = options.originFeats.find((f) => f.id === draft.speciesFeat);
			if (species?.feat && feat?.skills && draft.speciesFeatSkills.length !== feat.skills)
				out.push(`Choose ${feat.skills} skills for ${feat.name}.`);
			if (!background) out.push('Choose a background.');
			else if (draft.increaseMode === 'two') {
				if (!draft.plusTwo || !draft.plusOne || draft.plusTwo === draft.plusOne)
					out.push('Choose which ability rises by 2 and which by 1.');
			}
			break;
		}
		case 'abilities':
			if (draft.method === 'standard-array') {
				const left = unplaced(draft, options);
				if (left.length || ABILITY_IDS.some((a) => draft.base[a] === null))
					out.push(`Place ${left.join(', ')}.`);
			} else {
				const spent = pointsSpent(draft, options);
				if (spent > options.points) out.push(`${spent - options.points} points too many.`);
			}
			break;
		case 'skills': {
			if (!klass) break;
			if (draft.skills.length !== klass.skills.count)
				out.push(`Choose ${klass.skills.count} class skills (${draft.skills.length} so far).`);
			if (draft.expertise.length !== klass.expertise)
				out.push(`Choose ${klass.expertise} skills for Expertise.`);
			if (klass.fightingStyle && !draft.fightingStyle) out.push('Choose a Fighting Style.');
			if (draft.masteries.length !== klass.weaponMastery.count)
				out.push(`Choose ${klass.weaponMastery.count} weapons to master.`);
			break;
		}
		case 'spells': {
			const spells = klass?.spells;
			if (!spells) break;
			if (draft.cantrips.length !== spells.cantrips)
				out.push(`Choose ${spells.cantrips} cantrips (${draft.cantrips.length} so far).`);
			if (draft.prepared.length !== spells.prepared)
				out.push(`Prepare ${spells.prepared} spells (${draft.prepared.length} so far).`);
			break;
		}
		case 'gear':
			if (!draft.weapons.length) out.push('Choose at least one weapon.');
			break;
		case 'review':
			if (!draft.name.trim()) out.push('Give your character a name.');
			if (!draft.color) out.push('Choose a colour.');
			break;
	}
	return out;
}

/** Whether every step is done, so the choices can go to the server. */
export function complete(draft: Draft, options: CreatorOptions): boolean {
	return STEPS.every((s) => todo(draft, options, s.id).length === 0);
}

/** The draft as the choices the server reads. */
export function toChoices(draft: Draft, options: CreatorOptions): CreatorChoices {
	const background = options.backgrounds.find((b) => b.id === draft.backgroundId);
	const increases: Partial<Record<AbilityId, number>> =
		draft.increaseMode === 'three'
			? Object.fromEntries((background?.abilities ?? []).map((a) => [a, 1]))
			: {
					...(draft.plusTwo ? { [draft.plusTwo]: 2 } : {}),
					...(draft.plusOne ? { [draft.plusOne]: 1 } : {})
				};
	const base = Object.fromEntries(ABILITY_IDS.map((a) => [a, draft.base[a] ?? 0])) as Record<
		AbilityId,
		number
	>;
	const feat = options.originFeats.find((f) => f.id === draft.speciesFeat);
	return {
		name: draft.name.trim(),
		color: draft.color,
		species: {
			id: draft.speciesId ?? '',
			options: { ...draft.speciesOptions },
			feat: draft.speciesFeat
				? {
						feat: draft.speciesFeat,
						...(feat?.skills ? { skills: [...draft.speciesFeatSkills] } : {})
					}
				: null
		},
		background: { id: draft.backgroundId ?? '', increases },
		class: {
			id: draft.classId ?? '',
			skills: [...draft.skills],
			expertise: [...draft.expertise],
			fightingStyle: draft.fightingStyle,
			weaponMasteries: [...draft.masteries]
		},
		abilities: { method: draft.method, base },
		armor: { worn: draft.armor, shield: draft.shield },
		weapons: [...draft.weapons],
		spells: { cantrips: [...draft.cantrips], prepared: [...draft.prepared] }
	};
}

/** Choosing a class clears what depended on the one before. */
export function withClass(draft: Draft, classId: string): Draft {
	if (draft.classId === classId) return draft;
	return {
		...draft,
		classId,
		skills: [],
		expertise: [],
		fightingStyle: null,
		masteries: [],
		armor: null,
		shield: false,
		weapons: [],
		cantrips: [],
		prepared: []
	};
}

/** Choosing a species clears its options and feat. */
export function withSpecies(draft: Draft, speciesId: string): Draft {
	if (draft.speciesId === speciesId) return draft;
	return { ...draft, speciesId, speciesOptions: {}, speciesFeat: null, speciesFeatSkills: [] };
}

/** Choosing a background resets its increases. */
export function withBackground(draft: Draft, backgroundId: string): Draft {
	if (draft.backgroundId === backgroundId) return draft;
	return { ...draft, backgroundId, plusTwo: null, plusOne: null };
}

/** Adds or removes an item from a list of choices, keeping at most `max`. */
export function toggle(list: readonly string[], id: string, max: number): string[] {
	if (list.includes(id)) return list.filter((x) => x !== id);
	return list.length >= max ? [...list] : [...list, id];
}

const KEY = (roomId: string) => `thirdfold:creator:${roomId}`;

export function loadDraft(roomId: string): Draft | null {
	try {
		const raw = localStorage.getItem(KEY(roomId));
		if (!raw) return null;
		const draft = { ...emptyDraft(), ...JSON.parse(raw) } as Draft;
		return STEPS.some((s) => s.id === draft.step) ? draft : null;
	} catch {
		return null;
	}
}

export function saveDraft(roomId: string, draft: Draft | null): void {
	try {
		if (draft) localStorage.setItem(KEY(roomId), JSON.stringify(draft));
		else localStorage.removeItem(KEY(roomId));
	} catch {
		// Storage unavailable: the draft lasts as long as the page.
	}
}
