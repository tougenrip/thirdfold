// The Hollow Bell's four playable characters. Public data: every client may
// show it (character selection, status). The rules that use it run on the
// server. Adventure-specific, so it lives apart from the system-agnostic core
// in src/lib/game. Relative imports only: the game server imports this too.

export type CharacterId = 'warden' | 'veil' | 'ember' | 'saint';
export const CHARACTER_IDS: readonly CharacterId[] = ['warden', 'veil', 'ember', 'saint'];

export interface Attack {
	name: string;
	/** Reach in cells: 1 is melee (adjacent), more is ranged and needs line of sight. */
	range: number;
	/** Added to the d20 to-hit roll. */
	toHit: number;
	/** Damage dice expression, e.g. `1d8+3`. */
	damage: string;
}

export interface CharacterDef {
	id: CharacterId;
	name: string;
	tagline: string;
	/** Token colour, `#rrggbb`. */
	color: string;
	hp: number;
	/** Makes the character harder to hit: attacks must reach 10 + armor. */
	armor: number;
	/** Cells the character may move per round in an encounter. */
	speed: number;
	/** Vision in cells under fog of war. */
	vision: number;
	/** Light carried, in cells (0 for none). */
	light: number;
	attack: Attack;
}

export const CHARACTERS: Record<CharacterId, CharacterDef> = {
	warden: {
		id: 'warden',
		name: 'The Warden',
		tagline: 'A shield-bearer sworn to stand between the village and the dark.',
		color: '#2e86c1',
		hp: 30,
		armor: 3,
		speed: 5,
		vision: 6,
		light: 0,
		attack: { name: 'Bellguard blade', range: 1, toHit: 5, damage: '1d8+3' }
	},
	veil: {
		id: 'veil',
		name: 'The Veil',
		tagline: "A quiet blade who moves where the lamplight doesn't reach.",
		color: '#8e44ad',
		hp: 20,
		armor: 1,
		speed: 6,
		vision: 7,
		light: 0,
		attack: { name: 'Twin daggers', range: 1, toHit: 6, damage: '2d4+2' }
	},
	ember: {
		id: 'ember',
		name: 'The Ember',
		tagline: 'A wandering flame-caller. Fire answers when they speak.',
		color: '#e67e22',
		hp: 18,
		armor: 1,
		speed: 5,
		vision: 6,
		light: 3,
		attack: { name: 'Cinder bolt', range: 6, toHit: 4, damage: '1d10+1' }
	},
	saint: {
		id: 'saint',
		name: 'The Saint',
		tagline: 'A pilgrim healer whose faith is older than the bell.',
		color: '#d4ac0d',
		hp: 22,
		armor: 2,
		speed: 5,
		vision: 6,
		light: 0,
		attack: { name: 'Blessed mace', range: 1, toHit: 4, damage: '1d6+2' }
	}
};

export function isCharacterId(value: unknown): value is CharacterId {
	return typeof value === 'string' && (CHARACTER_IDS as readonly string[]).includes(value);
}

/** What an attack roll must reach to hit something with this much armor. */
export function defenseFor(armor: number): number {
	return 10 + armor;
}
