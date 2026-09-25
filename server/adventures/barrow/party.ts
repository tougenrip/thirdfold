// The Barrow's four characters, built by the fifth edition character rules
// from the SRD 5.2.1 catalog: each is a species, a background and a class
// with the choices those ask for, and every number the table uses (hit
// points, Armor Class, speed, scores, proficiencies, initiative) is derived
// from them. What they look like and do at this table (colour, words, the
// actions and their dice) is the adventure's, until equipment and spells are
// modelled; the dice add the derived modifiers.

import { CHARACTERS, type CharacterDef } from '../../../src/lib/adventure/characters';
import { srdCatalog } from '../../rules/dnd55e/catalog';
import { characterDefOf, type Presentation } from '../../rules/dnd55e/character/adventure';
import { deriveCharacter, type DerivedCharacter } from '../../rules/dnd55e/character/derive';
import type { CharacterChoices, DndCharacter } from '../../rules/dnd55e/character/model';
import { createCharacter } from '../../rules/dnd55e/character/validate';
import { DND_55E } from '../../rules/dnd55e';

const srd = (kind: string, slug: string) => `srd-5.2.1:${kind}:${slug}`;

export const PARTY_CHOICES: Record<'warden' | 'veil' | 'ember' | 'saint', CharacterChoices> = {
	warden: {
		id: 'warden',
		name: 'The Warden',
		level: 1,
		species: { id: srd('species', 'orc'), options: {}, feat: null },
		background: { id: srd('background', 'soldier'), increases: { str: 2, con: 1 } },
		class: {
			id: srd('class', 'fighter'),
			subclass: null,
			skills: ['perception', 'survival'],
			expertise: [],
			fightingStyle: srd('feat', 'defense'),
			weaponMasteries: [
				srd('weapon', 'longsword'),
				srd('weapon', 'spear'),
				srd('weapon', 'shortbow')
			]
		},
		abilities: {
			method: 'standard-array',
			base: { str: 15, dex: 12, con: 14, int: 8, wis: 13, cha: 10 }
		},
		feats: [],
		hitPoints: { method: 'average' },
		armor: { worn: srd('armor', 'chain-mail'), shield: true },
		notes: { 'Gaming Set': 'Dice' }
	},
	veil: {
		id: 'veil',
		name: 'The Veil',
		level: 1,
		species: { id: srd('species', 'halfling'), options: {}, feat: null },
		background: { id: srd('background', 'criminal'), increases: { dex: 2, con: 1 } },
		class: {
			id: srd('class', 'rogue'),
			subclass: null,
			skills: ['acrobatics', 'investigation', 'perception', 'insight'],
			expertise: ['stealth', 'sleight-of-hand'],
			fightingStyle: null,
			weaponMasteries: [srd('weapon', 'shortsword'), srd('weapon', 'shortbow')]
		},
		abilities: {
			method: 'standard-array',
			base: { str: 10, dex: 15, con: 14, int: 12, wis: 13, cha: 8 }
		},
		feats: [],
		hitPoints: { method: 'average' },
		armor: { worn: srd('armor', 'leather-armor'), shield: false },
		notes: {}
	},
	ember: {
		id: 'ember',
		name: 'The Ember',
		level: 1,
		species: {
			id: srd('species', 'elf'),
			options: { lineage: 'high-elf', spellcasting: 'int', 'keen-senses': 'perception' },
			feat: null
		},
		background: { id: srd('background', 'sage'), increases: { int: 2, con: 1 } },
		class: {
			id: srd('class', 'wizard'),
			subclass: null,
			skills: ['investigation', 'religion'],
			expertise: [],
			fightingStyle: null,
			weaponMasteries: []
		},
		abilities: {
			method: 'standard-array',
			base: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 }
		},
		feats: [],
		hitPoints: { method: 'average' },
		armor: { worn: null, shield: false },
		notes: { 'Magic Initiate (Wizard)': 'Light, Mage Hand; Sleep' }
	},
	saint: {
		id: 'saint',
		name: 'The Saint',
		level: 1,
		species: { id: srd('species', 'dwarf'), options: {}, feat: null },
		background: { id: srd('background', 'acolyte'), increases: { cha: 2, wis: 1 } },
		class: {
			id: srd('class', 'paladin'),
			subclass: null,
			skills: ['athletics', 'persuasion'],
			expertise: [],
			fightingStyle: null,
			weaponMasteries: [srd('weapon', 'mace'), srd('weapon', 'javelin')]
		},
		abilities: {
			method: 'standard-array',
			base: { str: 15, dex: 10, con: 13, int: 8, wis: 12, cha: 14 }
		},
		feats: [],
		hitPoints: { method: 'average' },
		armor: { worn: srd('armor', 'chain-mail'), shield: true },
		notes: { 'Magic Initiate (Cleric)': 'Guidance, Sacred Flame; Bless' }
	}
};

/** Makes one of the party; the choices are fixed, so a problem is a bug and throws. */
export function partyMember(id: keyof typeof PARTY_CHOICES): {
	character: DndCharacter;
	derived: DerivedCharacter;
} {
	const catalog = srdCatalog();
	const made = createCharacter(PARTY_CHOICES[id], catalog, DND_55E);
	if (!made.ok) throw new Error(`The Barrow's ${id}: ${made.problems.join('; ')}`);
	return { character: made.character, derived: deriveCharacter(made.character, catalog) };
}

const signed = (n: number) => (n < 0 ? `${n}` : `+${n}`);

function build(
	id: keyof typeof PARTY_CHOICES,
	presentation: (d: DerivedCharacter) => Presentation
): CharacterDef {
	const { derived } = partyMember(id);
	return characterDefOf(derived, presentation(derived));
}

export const warden = build('warden', (d) => ({
	...CHARACTERS.warden,
	intro:
		'The Warden sets a shield against the hill wind. Fighter, first of the watch: longsword, chain mail, and a second wind when it counts.',
	actions: [
		{
			id: 'longsword',
			name: 'Longsword',
			about: 'A steady cut with a longsword.',
			kind: 'attack',
			target: 'enemy',
			range: 1,
			stat: 'might',
			dice: `1d8${signed(d.modifiers.str)}`,
			uses: null
		},
		{
			id: 'second-wind',
			name: 'Second Wind',
			about: 'Draw on your stamina to heal yourself. A bonus action.',
			kind: 'heal',
			target: 'self',
			range: 0,
			stat: 'might',
			dice: `1d10+${d.level}`,
			uses: d.resources.find((r) => r.id === 'second-wind')!.max
		}
	],
	attacks: { longsword: 'str' },
	bonusActions: ['second-wind']
}));

export const veil = build('veil', (d) => ({
	...CHARACTERS.veil,
	intro:
		'The Veil is already at the barrow door, reading the dark. Rogue: a shortsword, a shortbow, and eyes for what others miss.',
	actions: [
		{
			id: 'shortsword',
			name: 'Shortsword',
			about: 'A quick thrust.',
			kind: 'attack',
			target: 'enemy',
			range: 1,
			stat: 'agility',
			dice: `1d6${signed(d.modifiers.dex)}`,
			uses: null
		},
		{
			id: 'shortbow',
			name: 'Shortbow',
			about: 'An arrow from afar. Hard to aim with a foe beside you.',
			kind: 'attack',
			target: 'enemy',
			range: 16,
			stat: 'agility',
			dice: `1d6${signed(d.modifiers.dex)}`,
			uses: null
		}
	],
	attacks: { shortsword: 'dex', shortbow: 'dex' },
	bonusActions: []
}));

export const ember = build('ember', (d) => ({
	...CHARACTERS.ember,
	intro:
		'The Ember raises a hooded lantern, and the hill door throws back its light. Wizard: a scholar of old wards, with a dagger and a light crossbow.',
	light: 3,
	actions: [
		{
			id: 'dagger',
			name: 'Dagger',
			about: 'A quick, light blade.',
			kind: 'attack',
			target: 'enemy',
			range: 1,
			stat: 'agility',
			dice: `1d4${signed(d.modifiers.dex)}`,
			uses: null
		},
		{
			id: 'crossbow',
			name: 'Light crossbow',
			about: 'A bolt from afar. Hard to aim with a foe beside you.',
			kind: 'attack',
			target: 'enemy',
			range: 16,
			stat: 'agility',
			dice: `1d8${signed(d.modifiers.dex)}`,
			uses: null
		}
	],
	attacks: { dagger: 'dex', crossbow: 'dex' },
	bonusActions: []
}));

export const saint = build('saint', (d) => ({
	...CHARACTERS.saint,
	intro:
		'The Saint touches the old stones and murmurs a name for the dead. Paladin: a mace, a shield, and hands that heal.',
	actions: [
		{
			id: 'mace',
			name: 'Mace',
			about: 'A plain iron mace.',
			kind: 'attack',
			target: 'enemy',
			range: 1,
			stat: 'might',
			dice: `1d6${signed(d.modifiers.str)}`,
			uses: null
		},
		{
			id: 'lay-on-hands',
			name: 'Lay On Hands',
			about: 'Touch an ally (or yourself) to restore 5 hit points. A bonus action.',
			kind: 'heal',
			target: 'ally',
			range: 1,
			stat: 'spirit',
			dice: '5',
			uses: 1
		}
	],
	attacks: { mace: 'str' },
	bonusActions: ['lay-on-hands']
}));
