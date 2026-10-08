// The Barrow's four characters, built by the fifth edition character rules
// from the SRD 5.2.1 catalog: each is a species, a background and a class
// with the choices those ask for, and the gear its class starts with; every
// number the table uses (hit points, Armor Class, speed, scores,
// proficiencies, initiative, its attacks from the weapons in its hands) is
// derived from them. What they look like at this table (colour, figure,
// words, light) is the adventure's.

import { CHARACTERS, type CharacterDef } from '../../../src/lib/adventure/characters';
import { srdCatalog } from '../../rules/dnd55e/catalog';
import { tableCharacter } from '../../rules/dnd55e/character/builder';
import { deriveCharacter, type DerivedCharacter } from '../../rules/dnd55e/character/derive';
import { startingInventory } from '../../rules/dnd55e/character/inventory';
import type { CharacterChoices, DndCharacter } from '../../rules/dnd55e/character/model';
import { createCharacter } from '../../rules/dnd55e/character/validate';
import { DND_55E } from '../../rules/dnd55e';

const srd = (kind: string, slug: string) => `srd-5.2.1:${kind}:${slug}`;
/** What a character starts with: its armor worn, its Shield, its weapons and their ammunition. */
const gear = (armor: string | null, shield: boolean, weapons: string[]) =>
	startingInventory({ armor, shield, weapons }, srdCatalog());

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
		inventory: gear(srd('armor', 'chain-mail'), true, [srd('weapon', 'longsword')]),
		spells: { cantrips: [], prepared: [] },
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
		inventory: gear(srd('armor', 'leather-armor'), false, [
			srd('weapon', 'shortsword'),
			srd('weapon', 'shortbow')
		]),
		spells: { cantrips: [], prepared: [] },
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
		inventory: gear(null, false, [srd('weapon', 'light-crossbow'), srd('weapon', 'dagger')]),
		spells: {
			cantrips: [
				srd('spell', 'fire-bolt'),
				srd('spell', 'ray-of-frost'),
				srd('spell', 'shocking-grasp')
			],
			prepared: [
				srd('spell', 'magic-missile'),
				srd('spell', 'burning-hands'),
				srd('spell', 'thunderwave'),
				srd('spell', 'sleep')
			]
		},
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
		inventory: gear(srd('armor', 'chain-mail'), true, [srd('weapon', 'mace')]),
		spells: { cantrips: [], prepared: [srd('spell', 'bless'), srd('spell', 'cure-wounds')] },
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

/** One of the party as the table plays it: its attacks from what it holds, its look the adventure's. */
function build(id: keyof typeof PARTY_CHOICES, intro: string): CharacterDef {
	const { character } = partyMember(id);
	const classic = CHARACTERS[id];
	return tableCharacter(character, classic.color, srdCatalog(), {
		intro,
		tagline: classic.tagline,
		model: id,
		vision: classic.vision,
		light: classic.light
	});
}

export const warden = build(
	'warden',
	'The Warden sets a shield against the hill wind. Fighter, first of the watch: longsword, chain mail, and a second wind when it counts.'
);

export const veil = build(
	'veil',
	'The Veil is already at the barrow door, reading the dark. Rogue: a shortsword, a shortbow, and eyes for what others miss.'
);

export const ember = build(
	'ember',
	'The Ember raises a hooded lantern, and the hill door throws back its light. Wizard: a scholar of old wards, with a dagger and a light crossbow.'
);

export const saint = build(
	'saint',
	'The Saint touches the old stones and murmurs a name for the dead. Paladin: a mace, a shield, and hands that heal.'
);
