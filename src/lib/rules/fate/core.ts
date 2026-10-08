// Fate Condensed (milestone 60, docs/SECOND-RULES.md): the shared, pure part
// of ruleset `fate-condensed` v1. The ladder, the default skill list, the
// four outcomes and the shape of a character's choices, which the builder
// page and the server both read; every number at the table is worked out on
// the server (server/rules/fate/). Relative imports only.
//
// Based on Fate Condensed, ©2020 Evil Hat Productions, LLC, under the
// Creative Commons Attribution 3.0 Unported licence: see FATE_ATTRIBUTION.

export const FATE_RULES = { id: 'fate-condensed', version: 1 } as const;

/** The credit the Fate Condensed SRD requires, verbatim. */
export const FATE_ATTRIBUTION =
	'This work is based on Fate Condensed (found at http://www.faterpg.com/), a product of Evil Hat Productions, LLC, developed, authored, and edited by PK Sullivan, Ed Turner, Leonard Balsera, Fred Hicks, Richard Bellingham, Robert Hanz, Ryan Macklin, and Sophie Lagacé, and licensed for our use under the Creative Commons Attribution 3.0 Unported license (http://creativecommons.org/licenses/by/3.0/).';

/** The adjective ladder, from Horrifying (−4) to Legendary (+8). */
export const LADDER: Readonly<Record<number, string>> = {
	8: 'Legendary',
	7: 'Epic',
	6: 'Fantastic',
	5: 'Superb',
	4: 'Great',
	3: 'Good',
	2: 'Fair',
	1: 'Average',
	0: 'Mediocre',
	[-1]: 'Poor',
	[-2]: 'Terrible',
	[-3]: 'Catastrophic',
	[-4]: 'Horrifying'
};

/** A rating on the ladder, as players read it: "Good (+3)". */
export function ladder(n: number): string {
	const name = LADDER[n] ?? (n > 8 ? 'Beyond Legendary' : 'Beyond Horrifying');
	return `${name} (${n >= 0 ? '+' : '−'}${Math.abs(n)})`;
}

/** The default skill list. */
export const FATE_SKILLS = [
	{ id: 'academics', name: 'Academics' },
	{ id: 'athletics', name: 'Athletics' },
	{ id: 'burglary', name: 'Burglary' },
	{ id: 'contacts', name: 'Contacts' },
	{ id: 'crafts', name: 'Crafts' },
	{ id: 'deceive', name: 'Deceive' },
	{ id: 'drive', name: 'Drive' },
	{ id: 'empathy', name: 'Empathy' },
	{ id: 'fight', name: 'Fight' },
	{ id: 'investigate', name: 'Investigate' },
	{ id: 'lore', name: 'Lore' },
	{ id: 'notice', name: 'Notice' },
	{ id: 'physique', name: 'Physique' },
	{ id: 'provoke', name: 'Provoke' },
	{ id: 'rapport', name: 'Rapport' },
	{ id: 'resources', name: 'Resources' },
	{ id: 'shoot', name: 'Shoot' },
	{ id: 'stealth', name: 'Stealth' },
	{ id: 'will', name: 'Will' }
] as const;
export type FateSkill = (typeof FATE_SKILLS)[number]['id'];

export const isFateSkill = (s: unknown): s is FateSkill =>
	typeof s === 'string' && FATE_SKILLS.some((k) => k.id === s);
export const skillName = (s: string): string => FATE_SKILLS.find((k) => k.id === s)?.name ?? s;

/** Starting skills: one Great (+4), two Good (+3), three Fair (+2), four Average (+1). */
export const PYRAMID: Readonly<Record<number, number>> = { 4: 1, 3: 2, 2: 3, 1: 4 };

/** The four actions; a stunt names one. */
export const FATE_ACTIONS = ['overcome', 'advantage', 'attack', 'defend'] as const;
export type FateAction = (typeof FATE_ACTIONS)[number];
export const ACTION_NAMES: Record<FateAction, string> = {
	overcome: 'overcome',
	advantage: 'create an advantage',
	attack: 'attack',
	defend: 'defend'
};

/** How a roll came out, by shifts over the difficulty or opposition. */
export type Outcome = 'fail' | 'tie' | 'success' | 'style';
export function outcomeOf(shifts: number): Outcome {
	return shifts < 0 ? 'fail' : shifts === 0 ? 'tie' : shifts < 3 ? 'success' : 'style';
}
export const OUTCOME_NAMES: Record<Outcome, string> = {
	fail: 'fail',
	tie: 'tie',
	success: 'success',
	style: 'success with style'
};

/** A bonus-granting stunt: +2 when the character uses `skill` to take `action`. */
export interface FateStunt {
	name: string;
	skill: FateSkill;
	action: FateAction;
	/** The circumstance, in the player's words. */
	when: string;
}

/** What a player chooses for a character. */
export interface FateChoices {
	name: string;
	highConcept: string;
	trouble: string;
	/** Up to three more aspects (a relationship, free aspects). */
	aspects: string[];
	/** Rated skills (the pyramid); the rest are Mediocre (+0). */
	skills: Partial<Record<FateSkill, number>>;
	/** Up to three stunts. */
	stunts: FateStunt[];
	/** Token colour, `#rrggbb`. */
	color: string;
}

export const FATE_LIMITS = {
	name: 40,
	aspect: 80,
	aspects: 3,
	stunts: 3,
	stuntName: 40,
	stuntWhen: 120
} as const;

/** Physical stress boxes by Physique: three, four from Average, six from Good. */
export function stressBoxes(physique: number): number {
	return physique >= 3 ? 6 : physique >= 1 ? 4 : 3;
}

/** Consequence slots (and what each absorbs): a second mild one from Superb Physique. */
export function consequenceSlots(
	physique: number
): { id: string; name: string; absorbs: number }[] {
	return [
		{ id: 'mild', name: 'Mild consequence', absorbs: 2 },
		...(physique >= 5 ? [{ id: 'mild-2', name: 'Second mild consequence', absorbs: 2 }] : []),
		{ id: 'moderate', name: 'Moderate consequence', absorbs: 4 },
		{ id: 'severe', name: 'Severe consequence', absorbs: 6 }
	];
}

/** Ready-made characters to start a party from (the builder's examples). */
export const FATE_PREGENS: readonly { id: string; choices: FateChoices }[] = [
	{
		id: 'marshal',
		choices: {
			name: 'Ida Brann',
			highConcept: 'Lantern-Bearing Marshal of the Fens',
			trouble: 'Owes the Ferryman a Favour',
			aspects: ['My Sister Keeps the Light at Hob’s End'],
			skills: {
				fight: 4,
				athletics: 3,
				notice: 3,
				physique: 2,
				will: 2,
				rapport: 2,
				shoot: 1,
				investigate: 1,
				provoke: 1,
				lore: 1
			},
			stunts: [
				{
					name: 'Shield Wall',
					skill: 'fight',
					action: 'defend',
					when: 'I stand between a foe and someone weaker'
				}
			],
			color: '#3c78b4'
		}
	},
	{
		id: 'fowler',
		choices: {
			name: 'Wren Holloway',
			highConcept: 'Reed-Hunter With a Long Bow',
			trouble: 'Never Learned to Let Things Lie',
			aspects: ['The Fens Talk to Me'],
			skills: {
				shoot: 4,
				stealth: 3,
				notice: 3,
				athletics: 2,
				investigate: 2,
				physique: 2,
				fight: 1,
				lore: 1,
				empathy: 1,
				crafts: 1
			},
			stunts: [
				{
					name: 'Marked',
					skill: 'shoot',
					action: 'attack',
					when: 'my quarry hasn’t seen me yet'
				}
			],
			color: '#5a9a3c'
		}
	},
	{
		id: 'scholar',
		choices: {
			name: 'Brother Aldous',
			highConcept: 'Lapsed Archivist of the Drowned Abbey',
			trouble: 'Curiosity Before Caution',
			aspects: ['I Read the Ledgers Nobody Else Kept'],
			skills: {
				lore: 4,
				investigate: 3,
				academics: 3,
				notice: 2,
				will: 2,
				empathy: 2,
				athletics: 1,
				fight: 1,
				rapport: 1,
				physique: 1
			},
			stunts: [
				{
					name: 'Seen It Written',
					skill: 'investigate',
					action: 'overcome',
					when: 'old writing or old stone is involved'
				}
			],
			color: '#9a6a3c'
		}
	}
];
