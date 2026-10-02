// A fifth edition character's full sheet, worked out once when the table
// character is made (the choices don't change mid-story): what the player
// chose, what the rules work out beyond the card's numbers, and the rules
// text of each feature and feat, from the catalog. It travels in the
// character's sheet data and the rules put it on the card as `details`.

import type { Action } from '../../../../src/lib/adventure/characters';
import type { CardResource } from '../../../../src/lib/adventure/adventure';
import type {
	DndSheetDetails,
	SheetFeature,
	SheetSpell
} from '../../../../src/lib/rules/dnd55e/sheet';
import type { Catalog } from '../catalog';
import { ABILITIES, abilityName, skillOf, type Ability } from '../core';
import type { DerivedCharacter } from './derive';
import { featsOf } from './derive';
import type { DndCharacter } from './model';
import { gearOf, kindText } from './inventory';
import { SPECIES_OPTIONS, trainedWith } from './options';

const METHODS: Record<DndCharacter['abilities']['method'], string> = {
	'standard-array': 'Standard array',
	'point-buy': 'Point buy',
	rolled: 'Rolled'
};

const titled = (value: string) =>
	value
		.split('-')
		.map((w) => w[0].toUpperCase() + w.slice(1))
		.join(' ');
const OPTION_LABELS: Record<string, string> = {
	'keen-senses': 'Keen Senses',
	skillful: 'Skillful',
	spellcasting: 'Spellcasting ability'
};

export function sheetDetails(
	character: DndCharacter,
	derived: DerivedCharacter,
	catalog: Catalog,
	actions: readonly Action[],
	spells: SheetSpell[] = []
): { details: DndSheetDetails; resources: CardResource[] } {
	const klass = catalog.get('class', character.class.id)!;
	const worn = character.inventory.find((e) => e.equipped === 'armor');
	const species = catalog.get('species', character.species.id)!;
	const subclass = character.class.subclass
		? catalog.get('subclass', character.class.subclass)
		: null;
	const skillName = (id: string) => skillOf(id)?.name ?? id;
	const increases: Partial<Record<Ability, number>> = {};
	const add = (inc: Partial<Record<Ability, number>> | undefined) => {
		for (const [a, n] of Object.entries(inc ?? {}))
			increases[a as Ability] = (increases[a as Ability] ?? 0) + (n ?? 0);
	};
	add(character.background.increases);
	const feats = featsOf(character, catalog);
	for (const f of feats) add(f.increases);

	const specs = SPECIES_OPTIONS[species.id] ?? {};
	const speciesOptions = Object.entries(character.species.options).map(([key, value]) => ({
		label: OPTION_LABELS[key] ?? titled(key),
		value:
			specs[key]?.kind === 'skill'
				? skillName(value)
				: key === 'spellcasting'
					? abilityName(value as Ability)
					: titled(value)
	}));

	const featureText = (text: string) => text.split('\n\n').slice(0, 3).join('\n\n');
	const features: SheetFeature[] = [
		...species.data.traits.map((t) => ({
			name: t.name,
			text: featureText(t.text),
			from: 'Species',
			level: null
		})),
		...klass.data.features
			.filter((f) => f.level <= character.level)
			.map((f) => ({ name: f.name, text: featureText(f.text), from: 'Class', level: f.level })),
		...(subclass?.data.features ?? [])
			.filter((f) => f.level <= character.level)
			.map((f) => ({ name: f.name, text: featureText(f.text), from: 'Subclass', level: f.level }))
	];

	const details: DndSheetDetails = {
		choices: {
			species: species.name,
			speciesOptions,
			background: derived.background,
			class: klass.name,
			subclass: subclass?.name ?? null,
			level: character.level,
			scores: METHODS[character.abilities.method],
			base: ABILITIES.map((a) => ({
				id: a.id,
				name: a.name,
				score: character.abilities.base[a.id],
				increase: increases[a.id] ?? 0
			})),
			skills: character.class.skills.map(skillName),
			expertise: character.class.expertise.map(skillName),
			fightingStyle: character.class.fightingStyle
				? (catalog.get('feat', character.class.fightingStyle)?.name ?? null)
				: null,
			weaponMasteries: character.class.weaponMasteries.map(
				(id) => catalog.get('weapon', id)?.name ?? id
			),
			kept: Object.entries(character.notes).map(([name, value]) => ({ name, value }))
		},
		derived: {
			initiative: derived.initiative,
			speed: derived.speed,
			passivePerception: derived.passivePerception,
			hitDie: derived.hitDice.die,
			hitDice: derived.hitDice.total
		},
		features,
		feats: feats.map((f) => {
			const record = catalog.get('feat', f.feat)!;
			return {
				name: record.name,
				text: record.data.benefits.length
					? record.data.benefits.map((b) => `${b.name}. ${b.text}`).join('\n\n')
					: record.text.split('\n\n').slice(1).join('\n\n')
			};
		}),
		proficiencies: {
			armor: derived.proficiencies.armor.map((a) => (a === 'shield' ? 'Shields' : titled(a))),
			weapons: derived.proficiencies.weapons,
			tools: derived.proficiencies.tools
		},
		gear: (['weapon', 'armor', 'ammunition'] as const).flatMap((kind) =>
			catalog.all(kind).map((r) => {
				const g = gearOf(catalog, r.id)!;
				return { id: r.id, name: r.name, kind: kindText(g) };
			})
		),
		equipment: {
			armor: worn ? (catalog.get('armor', worn.item)?.name ?? null) : null,
			shield: character.inventory.some((e) => e.equipped === 'shield'),
			weapons: [
				...new Map(
					character.inventory
						.filter((e) => e.item.includes(':weapon:'))
						.map((e) => [e.item + (e.equipped ? ':held' : ''), e])
				).values()
			].map((e) => {
				const w = catalog.get('weapon', e.item)!;
				return {
					name: w.name,
					damage: `${w.data.damage} ${w.data.damageType.toLowerCase()}`,
					properties: w.data.properties,
					mastery: w.data.mastery,
					mastered: character.class.weaponMasteries.includes(e.item),
					held: e.equipped === 'hand',
					trained: trainedWith(klass.data, w.data)
				};
			})
		},
		spellcasting: derived.spellcasting
			? {
					ability: abilityName(derived.spellcasting.ability),
					saveDc: derived.spellcasting.saveDc,
					attackBonus: derived.spellcasting.attackBonus,
					cantrips: derived.spellcasting.cantrips,
					prepared: derived.spellcasting.prepared,
					spells
				}
			: null
	};

	// An action that spends a resource (Second Wind, Lay On Hands) keeps its count in play.
	const resources: CardResource[] = derived.resources.map((r) => {
		const action = actions.find((a) => a.id === r.id);
		return action && action.uses !== null
			? { id: r.id, name: r.name, max: action.uses, trackedBy: action.id }
			: { id: r.id, name: r.name, max: r.max, trackedBy: null };
	});
	return { details, resources };
}
