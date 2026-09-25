// The Hollow Bell's four playable characters: stats, actions and the status
// effects actions can cause. Public data: every client may show it (character
// selection, the character sheet). The rules that use it run on the server.
// Adventure-specific, so it lives apart from the system-agnostic core in
// src/lib/game. Relative imports only: the game server imports this too.

/** A playable character's id, within its adventure. */
export type CharacterId = string;
export const CHARACTER_IDS: readonly CharacterId[] = ['warden', 'veil', 'ember', 'saint'];

export type StatId = 'might' | 'agility' | 'wits' | 'spirit';
export const STATS: readonly { id: StatId; name: string; about: string }[] = [
	{ id: 'might', name: 'Might', about: 'Strength and toughness; heavy blows.' },
	{ id: 'agility', name: 'Agility', about: 'Speed and precision; quick blades.' },
	{ id: 'wits', name: 'Wits', about: 'Focus and cunning; spells and aim.' },
	{ id: 'spirit', name: 'Spirit', about: 'Faith and will; healing.' }
];

export type StatusId = 'guarded' | 'slowed' | 'burning';
export const STATUSES: Record<StatusId, { name: string; about: string }> = {
	guarded: { name: 'Guarded', about: '+2 armor.' },
	slowed: { name: 'Slowed', about: 'Moves at half speed.' },
	burning: { name: 'Burning', about: 'Takes 1d4 fire damage at the start of its turn.' }
};
export const STATUS_IDS = Object.keys(STATUSES) as StatusId[];

/**
 * An enemy's attack: a d20 plus `toHit` against the target's defense, then
 * `damage` on a hit. With `save`, there is no attack roll: the target makes
 * a saving throw (the stat by the story's rules) against `dc`, and takes the
 * damage on a failure (half on a success, when `half`).
 */
export interface Attack {
	name: string;
	/** Reach in cells: 1 is melee (adjacent), more is ranged and needs line of sight. */
	range: number;
	toHit: number;
	/** Damage dice expression, e.g. `1d8+3`. */
	damage: string;
	save?: { stat: string; dc: number; half: boolean };
}

/**
 * Plain data a ruleset reads about a character (ability scores, level,
 * proficiencies, …): whatever that ruleset defines, checked by it on the
 * server. The shared model knows nothing of its contents.
 */
export type RulesValue = number | string | boolean | readonly RulesValue[] | RulesData;
export interface RulesData {
	readonly [key: string]: RulesValue;
}

/** Something a character can do with their action. */
export interface Action {
	id: string;
	name: string;
	about: string;
	/** attack: to-hit roll then damage; heal: restores hit points; guard: a status on self and allies beside. */
	kind: 'attack' | 'heal' | 'guard';
	target: 'enemy' | 'ally' | 'self';
	/** Reach in cells (0 for self). Beyond 1 it needs a clear line. */
	range: number;
	/** The stat behind it: attack rolls add 2 + this stat. */
	stat: StatId;
	/** Damage (attack) or healing (heal) dice. */
	dice?: string;
	/** A status the action puts on its target (attack, on a hit) or on the guarded (guard). */
	applies?: { status: StatusId; rounds: number };
	/** Uses per encounter; null for as often as you like. */
	uses: number | null;
}

export interface CharacterDef {
	id: CharacterId;
	name: string;
	tagline: string;
	/** Read out when a player takes the character. */
	intro: string;
	/** Token colour, `#rrggbb`. */
	color: string;
	hp: number;
	/** Makes the character harder to hit (classic rules: attacks must reach 10 + armor; others read it as they define). */
	armor: number;
	/** Cells the character may move per round in an encounter. */
	speed: number;
	/** Vision in cells under fog of war. */
	vision: number;
	/** Light carried, in cells (0 for none). */
	light: number;
	stats: Record<StatId, number>;
	/** The first is the character's basic attack. */
	actions: readonly Action[];
	/** What a story's ruleset needs beyond the above (e.g. ability scores); absent under the classic rules. */
	sheet?: RulesData;
}

export const CHARACTERS: Record<CharacterId, CharacterDef> = {
	warden: {
		id: 'warden',
		name: 'The Warden',
		tagline: 'A shield-bearer sworn to stand between the helpless and the dark.',
		intro:
			'The Warden steps into the lamplight, shield scarred by a hundred nights on the valley road. Where the Warden stands, nothing gets past.',
		color: '#2e86c1',
		hp: 30,
		armor: 3,
		speed: 5,
		vision: 6,
		light: 0,
		stats: { might: 3, agility: 0, wits: 1, spirit: 1 },
		actions: [
			{
				id: 'blade',
				name: 'Warden’s blade',
				about: 'A heavy, steady cut.',
				kind: 'attack',
				target: 'enemy',
				range: 1,
				stat: 'might',
				dice: '1d8+3',
				uses: null
			},
			{
				id: 'shield-wall',
				name: 'Shield wall',
				about:
					'Brace behind your shield: you and every ally beside you are guarded (+2 armor) until the enemies have acted.',
				kind: 'guard',
				target: 'self',
				range: 0,
				stat: 'might',
				applies: { status: 'guarded', rounds: 1 },
				uses: null
			}
		]
	},
	veil: {
		id: 'veil',
		name: 'The Veil',
		tagline: "A quiet blade who moves where the lamplight doesn't reach.",
		intro:
			'The Veil was already here, somewhere in the shadow of the inn, before anyone noticed. Two knives, no questions.',
		color: '#8e44ad',
		hp: 20,
		armor: 1,
		speed: 6,
		vision: 7,
		light: 0,
		stats: { might: 1, agility: 4, wits: 2, spirit: 0 },
		actions: [
			{
				id: 'daggers',
				name: 'Twin daggers',
				about: 'Two quick strikes, one roll.',
				kind: 'attack',
				target: 'enemy',
				range: 1,
				stat: 'agility',
				dice: '2d4+2',
				uses: null
			},
			{
				id: 'hamstring',
				name: 'Hamstring',
				about:
					'A low cut that leaves a foe limping: on a hit it is slowed (half speed) on its next turn.',
				kind: 'attack',
				target: 'enemy',
				range: 1,
				stat: 'agility',
				dice: '1d4+2',
				applies: { status: 'slowed', rounds: 1 },
				uses: 2
			}
		]
	},
	ember: {
		id: 'ember',
		name: 'The Ember',
		tagline: 'A wandering flame-caller. Fire answers when they speak.',
		intro:
			'Sparks drift from the Ember’s fingertips and die in the cold air. The lamps of Bellweather lean toward them, just slightly.',
		color: '#e67e22',
		hp: 18,
		armor: 1,
		speed: 5,
		vision: 6,
		light: 3,
		stats: { might: 0, agility: 1, wits: 2, spirit: 2 },
		actions: [
			{
				id: 'cinder-bolt',
				name: 'Cinder bolt',
				about: 'A spitting bolt of flame, thrown from afar.',
				kind: 'attack',
				target: 'enemy',
				range: 6,
				stat: 'wits',
				dice: '1d10+1',
				uses: null
			},
			{
				id: 'flame-burst',
				name: 'Flame burst',
				about:
					'Wreathe a foe in fire: on a hit it burns for 1d4 at the start of its next two turns.',
				kind: 'attack',
				target: 'enemy',
				range: 4,
				stat: 'wits',
				dice: '2d6+2',
				applies: { status: 'burning', rounds: 2 },
				uses: 1
			}
		]
	},
	saint: {
		id: 'saint',
		name: 'The Saint',
		tagline: 'A pilgrim healer whose faith is older than the road.',
		intro:
			'The Saint touches the wayside shrine at the edge of the square and murmurs a name nobody else remembers.',
		color: '#d4ac0d',
		hp: 22,
		armor: 2,
		speed: 5,
		vision: 6,
		light: 0,
		stats: { might: 2, agility: 0, wits: 1, spirit: 3 },
		actions: [
			{
				id: 'mace',
				name: 'Blessed mace',
				about: 'A plain iron mace, blessed twice.',
				kind: 'attack',
				target: 'enemy',
				range: 1,
				stat: 'might',
				dice: '1d6+2',
				uses: null
			},
			{
				id: 'mend',
				name: 'Mend',
				about:
					'Close the wounds of an ally within 3 cells (or your own): heals 1d8+3, and brings a fallen ally back to their feet.',
				kind: 'heal',
				target: 'ally',
				range: 3,
				stat: 'spirit',
				dice: '1d8+3',
				uses: 2
			}
		]
	}
};

export function isCharacterId(value: unknown): value is CharacterId {
	return typeof value === 'string' && (CHARACTER_IDS as readonly string[]).includes(value);
}

export function isStatusId(value: unknown): value is StatusId {
	return typeof value === 'string' && Object.hasOwn(STATUSES, value);
}

/** What an attack roll must reach to hit something with this much armor. */
export function defenseFor(armor: number): number {
	return 10 + armor;
}

/** A character's attack bonus for an action: 2 plus the action's stat. */
export function toHitFor(character: CharacterDef, action: Action): number {
	return 2 + character.stats[action.stat];
}

export function actionOf(character: CharacterDef, actionId: string): Action | undefined {
	return character.actions.find((a) => a.id === actionId);
}

/** Rounds a downed character lasts before dying, unless healed. */
export const BLEED_OUT_ROUNDS = 3;

/** A one-line summary of an action for buttons and sheets, e.g. "Melee · +5 to hit · 1d8+3". */
export function describeAction(character: CharacterDef, action: Action): string {
	return summarizeAction(action, toHitFor(character, action));
}

/** The same summary, with the attack bonus as the story's rules work it out. */
export function summarizeAction(action: Action, toHit: number): string {
	const reach =
		action.target === 'self'
			? action.kind === 'heal'
				? 'Yourself'
				: 'You and allies beside you'
			: action.range <= 1
				? 'Melee'
				: `Range ${action.range}`;
	const parts = [reach];
	if (action.kind === 'attack')
		parts.push(`${toHit >= 0 ? '+' : ''}${toHit} to hit`, `${action.dice} damage`);
	if (action.kind === 'heal') parts.push(`heals ${action.dice}`);
	if (action.applies) parts.push(STATUSES[action.applies.status].name.toLowerCase());
	if (action.uses !== null) parts.push(`${action.uses}× per fight`);
	return parts.join(' · ');
}
