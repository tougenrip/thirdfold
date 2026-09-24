// The enemies of The Hollow Bell: three kinds, each with its own way of
// fighting. The Hollow Hound runs down the nearest character and bites. The
// Bell Cultist keeps its distance and slings stones, drawing a knife only when
// cornered. The Bell Keeper, the Bell's warden in the Hollow, is slow and
// hard to hurt, swings a great hammer, and every other turn tolls the bell it
// carries: everyone near it is shaken and slowed. When the Hollow itself
// wakes, its tendrils rise from the pit and grasp at whoever is in reach, and
// if the party breaks the Bell, its Hand comes up after them. Stat blocks
// here; the rules that use them run in engine.ts.

import type { Attack } from '../../src/lib/adventure/characters';

export type EnemyKind = 'hound' | 'cultist' | 'keeper' | 'tendril' | 'hand' | 'heart';

export const ENEMY_KINDS: readonly EnemyKind[] = [
	'hound',
	'cultist',
	'keeper',
	'tendril',
	'hand',
	'heart'
];

/** How an enemy chooses what to do on its turn. */
export type Behavior =
	/** Close on the nearest standing character and attack. */
	| 'rush'
	/** Stay at range and use the ranged attack; melee only when someone is beside it. */
	| 'skirmish'
	/** Close in slowly; toll the bell when characters crowd it. */
	| 'guardian'
	/** Rooted where it rose: seize whoever is in reach, the weakest first. */
	| 'grasp';

export interface EnemyDef {
	kind: EnemyKind;
	name: string;
	/** Token colour, `#rrggbb`. */
	color: string;
	armor: number;
	speed: number;
	vision: number;
	/** Light it carries, in cells (a cultist's lantern); 0 for none. */
	light: number;
	/** Added to its d20 for initiative. */
	initiative: number;
	/** Hit points for a party of this many characters. */
	hp: (characters: number) => number;
	/** The first is its melee attack; a second, longer one is ranged. */
	attacks: readonly Attack[];
	behavior: Behavior;
	/** The Keeper's toll: damage and a status to everyone standing within `range`, then a rest. */
	toll?: { range: number; damage: string; rounds: number; every: number };
}

const party = (n: number) => Math.max(1, n);

export const ENEMIES: Record<EnemyKind, EnemyDef> = {
	hound: {
		kind: 'hound',
		name: 'Hollow Hound',
		color: '#c9d1d6',
		armor: 1,
		speed: 6,
		vision: 8,
		light: 0,
		initiative: 3,
		hp: (n) => 10 + 6 * party(n),
		attacks: [{ name: 'Bite', range: 1, toHit: 4, damage: '1d6+2' }],
		behavior: 'rush'
	},
	cultist: {
		kind: 'cultist',
		name: 'Bell Cultist',
		color: '#8a3b3b',
		armor: 1,
		speed: 5,
		vision: 8,
		light: 2,
		initiative: 1,
		hp: (n) => 6 + 3 * party(n),
		attacks: [
			{ name: 'Ritual knife', range: 1, toHit: 3, damage: '1d6+1' },
			{ name: 'Sling', range: 5, toHit: 3, damage: '1d4+1' }
		],
		behavior: 'skirmish'
	},
	keeper: {
		kind: 'keeper',
		name: 'Bell Keeper',
		color: '#3b3f5c',
		armor: 4,
		speed: 4,
		vision: 8,
		light: 0,
		initiative: 0,
		hp: (n) => 20 + 10 * party(n),
		attacks: [{ name: 'Bell hammer', range: 1, toHit: 5, damage: '1d10+2' }],
		behavior: 'guardian',
		toll: { range: 2, damage: '1d4', rounds: 1, every: 2 }
	},
	tendril: {
		kind: 'tendril',
		name: 'Hollow Tendril',
		color: '#b7a9c9',
		armor: 0,
		speed: 0,
		vision: 6,
		light: 0,
		initiative: 2,
		hp: (n) => 4 + 3 * party(n),
		attacks: [{ name: 'Grasp', range: 2, toHit: 3, damage: '1d6' }],
		behavior: 'grasp'
	},
	hand: {
		kind: 'hand',
		name: 'The Hollow’s Hand',
		color: '#6d6478',
		armor: 2,
		speed: 0,
		vision: 12,
		light: 0,
		initiative: 4,
		hp: (n) => 24 + 12 * party(n),
		attacks: [{ name: 'Crushing grip', range: 3, toHit: 5, damage: '2d6+2' }],
		behavior: 'grasp'
	},
	heart: {
		kind: 'heart',
		name: 'The Hollow’s Heart',
		color: '#7a1f2b',
		armor: 3,
		speed: 0,
		vision: 12,
		light: 0,
		initiative: 0,
		hp: (n) => 30 + 14 * party(n),
		attacks: [{ name: 'Pulse', range: 5, toHit: 5, damage: '1d10+2' }],
		behavior: 'grasp'
	}
};

/** The younger hounds that come up the stair when the bell rings are weaker. */
export const PUP_HP = (n: number) => 6 + 3 * party(n);
