// Ready-made level 1 fifth edition characters (milestone 57): legal choices
// from the SRD 5.2.1 catalog, the same shape a player's choices take in the
// character creator, for a creator to drop into an adventure's party
// (`AdventureFile.party`) and rename. They are plain data: the server builds
// and checks each with the rules' character builder, as it would a player's.
// Relative imports only: the game server's tests import this too.

import type { CreatorChoices } from './creator';

const srd = (kind: string, slug: string) => `srd-5.2.1:${kind}:${slug}`;

export interface Pregen {
	id: string;
	/** What the builder offers it as. */
	label: string;
	choices: CreatorChoices;
}

export const DND_PREGENS: readonly Pregen[] = [
	{
		id: 'fighter',
		label: 'Orc Fighter (Soldier): longsword, Shield, chain mail',
		choices: {
			name: 'Brakka',
			color: '#c0392b',
			species: { id: srd('species', 'orc'), options: {}, feat: null },
			background: { id: srd('background', 'soldier'), increases: { str: 2, con: 1 } },
			class: {
				id: srd('class', 'fighter'),
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
			armor: { worn: srd('armor', 'chain-mail'), shield: true },
			weapons: [srd('weapon', 'longsword')]
		}
	},
	{
		id: 'rogue',
		label: 'Human Rogue (Criminal): rapier, shortbow, leather armor',
		choices: {
			name: 'Wren',
			color: '#17a589',
			species: {
				id: srd('species', 'human'),
				options: { size: 'small', skillful: 'perception' },
				feat: { feat: srd('feat', 'skilled'), skills: ['history', 'medicine', 'survival'] }
			},
			background: { id: srd('background', 'criminal'), increases: { dex: 2, int: 1 } },
			class: {
				id: srd('class', 'rogue'),
				skills: ['acrobatics', 'insight', 'investigation', 'persuasion'],
				expertise: ['stealth', 'investigation'],
				fightingStyle: null,
				weaponMasteries: [srd('weapon', 'rapier'), srd('weapon', 'shortbow')]
			},
			abilities: {
				method: 'point-buy',
				base: { str: 8, dex: 15, con: 14, int: 13, wis: 12, cha: 10 }
			},
			armor: { worn: srd('armor', 'leather-armor'), shield: false },
			weapons: [srd('weapon', 'rapier'), srd('weapon', 'shortbow')]
		}
	},
	{
		id: 'wizard',
		label: 'Elf Wizard (Sage): Fire Bolt, Magic Missile, Sleep',
		choices: {
			name: 'Ilse',
			color: '#8e44ad',
			species: {
				id: srd('species', 'elf'),
				options: { lineage: 'high-elf', spellcasting: 'int', 'keen-senses': 'perception' },
				feat: null
			},
			background: { id: srd('background', 'sage'), increases: { int: 2, con: 1 } },
			class: {
				id: srd('class', 'wizard'),
				skills: ['investigation', 'religion'],
				expertise: [],
				fightingStyle: null,
				weaponMasteries: []
			},
			abilities: {
				method: 'standard-array',
				base: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 }
			},
			armor: { worn: null, shield: false },
			weapons: [srd('weapon', 'dagger')],
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
			}
		}
	}
];

/** A pregen's choices, to copy into a file (never the shared object itself). */
export function pregenChoices(id: string): CreatorChoices | null {
	const p = DND_PREGENS.find((x) => x.id === id);
	return p ? structuredClone(p.choices) : null;
}
