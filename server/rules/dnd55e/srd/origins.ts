// Character origins and feats: backgrounds and species from "Character
// Origins", feats from "Feats". Each is a 12 pt name; a background or a
// species follows it with labelled fields ("Ability Scores:", "Creature
// Type:"), a feat with its category line ("General Feat (Prerequisite:
// Level 4+)"); then run-in blocks ("Darkvision. You have …").

import type { CatalogRecord } from '../../../../src/lib/content/catalog';
import type { SrdDocument } from './document';
import { blocks, labelled, record, slice } from './entries';
import type { Line } from './pdf';
import type { BackgroundData, FeatData, SpeciesData } from './records';

type Entry = { line: Line; index: number }[];

/** Entries of a range: a 12 pt heading that `starts` says begins one, up to the next. */
function entries(doc: SrdDocument, path: string[], starts: (next: string) => boolean): Entry[] {
	const lines = slice(doc, doc.range(path));
	const heads: number[] = [];
	for (let k = 0; k + 1 < lines.length; k++) {
		const l = lines[k].line;
		if (l.size > 11.5 && l.size < 12.5 && starts(lines[k + 1].line.text)) heads.push(k);
	}
	return heads.map((h, n) => {
		// An entry ends at the next entry, or at a larger heading (a new category).
		let end = n + 1 < heads.length ? heads[n + 1] : lines.length;
		for (let k = h + 1; k < end; k++) if (lines[k].line.size > 12.5) end = k;
		return lines.slice(h, end);
	});
}

/** Labelled fields at the top of an entry (values may wrap), and the lines after them. */
function fields(
	doc: SrdDocument,
	entry: Entry,
	labels: readonly string[]
): { values: Record<string, string>; rest: Line[] } {
	const values: Record<string, string> = {};
	let last: string | null = null;
	let k = 1;
	for (; k < entry.length; k++) {
		const line = entry[k].line;
		const f = labelled(line.text, labels);
		if (f && !(f.label in values)) {
			values[f.label] = f.value;
			last = f.label;
		} else if (last && !f && entry[k - 1].line.size === line.size && !isLead(line)) {
			values[last] = doc.join(values[last], line.text);
		} else break;
	}
	return { values, rest: entry.slice(k).map((e) => e.line) };
}

/** The sentence introducing a species' traits, or a feat's benefits. */
const isLead = (line: Line) => /^(As an? .*, you have|You gain the following)/.test(line.text);

const list = (text: string) =>
	text
		.split(/,\s*|\s+and\s+|\s+or\s+/)
		.map((s) => s.replace(/^and\s+/, '').trim())
		.filter(Boolean);

const BACKGROUND = [
	'Ability Scores',
	'Feat',
	'Skill Proficiencies',
	'Tool Proficiency',
	'Equipment'
];

export function parseBackgrounds(doc: SrdDocument): CatalogRecord<'background', BackgroundData>[] {
	return entries(doc, ['Character Origins', 'Character Backgrounds'], (next) =>
		next.startsWith('Ability Scores:')
	).map((entry) => {
		const name = entry[0].line.text;
		const { values, rest } = fields(doc, entry, BACKGROUND);
		for (const label of BACKGROUND)
			if (!values[label])
				doc.note({
					kind: 'note',
					at: `background ${name}`,
					message: `No ${label} field.`,
					pages: [entry[0].line.page]
				});
		const data: BackgroundData = {
			abilities: list(values['Ability Scores'] ?? ''),
			feat: (values.Feat ?? '').replace(/\s*\(see “Feats”\)$/, ''),
			skills: list(values['Skill Proficiencies'] ?? ''),
			tool: values['Tool Proficiency'] ?? '',
			equipment: values.Equipment ?? ''
		};
		const text = [...BACKGROUND.map((l) => `${l}: ${values[l] ?? ''}`), ...doc.paragraphs(rest)];
		return record(
			doc,
			'background',
			name,
			data,
			text,
			entry.map((e) => e.line),
			entry[0].index
		);
	});
}

const SPECIES = ['Creature Type', 'Size', 'Speed'];

export function parseSpecies(doc: SrdDocument): CatalogRecord<'species', SpeciesData>[] {
	return entries(doc, ['Character Origins', 'Character Species'], (next) =>
		next.startsWith('Creature Type:')
	).map((entry) => {
		const name = entry[0].line.text;
		const { values, rest } = fields(doc, entry, SPECIES);
		const pieces = doc.pieces(rest);
		const read = blocks(pieces);
		const speed = /^(\d+) feet/.exec(values.Speed ?? '');
		if (!speed)
			doc.note({
				kind: 'note',
				at: `species ${name}`,
				message: `Speed not read ("${values.Speed ?? ''}").`,
				pages: [entry[0].line.page]
			});
		const data: SpeciesData = {
			creatureType: values['Creature Type'] ?? '',
			size: values.Size ?? '',
			speed: speed ? Number(speed[1]) : 0,
			traits: read.blocks
		};
		const text = [...SPECIES.map((l) => `${l}: ${values[l] ?? ''}`), ...pieces.map((p) => p.text)];
		return record(
			doc,
			'species',
			name,
			data,
			text,
			entry.map((e) => e.line),
			entry[0].index
		);
	});
}

const FEAT_LINE = /^(Origin|General|Fighting Style|Epic Boon) Feat(?: \(Prerequisite: (.+)\))?$/;

export function parseFeats(doc: SrdDocument): CatalogRecord<'feat', FeatData>[] {
	return entries(doc, ['Feats', 'Feat Descriptions'], (next) =>
		/^(Origin|General|Fighting Style|Epic Boon) Feat\b/.test(next)
	).flatMap((entry) => {
		const name = entry[0].line.text;
		// The category line may wrap: "General Feat (Prerequisite: Level 4+, Strength
		// or Dexterity 13+)".
		let k = 1;
		let line = entry[1].line.text;
		while (
			!FEAT_LINE.test(line) &&
			k + 1 < entry.length &&
			entry[k + 1].line.size === entry[1].line.size &&
			k < 3
		) {
			k++;
			line = doc.join(line, entry[k].line.text);
		}
		const m = FEAT_LINE.exec(line);
		if (!m) {
			doc.note({
				kind: 'skipped',
				at: `feat ${name}`,
				message: `Category line not read ("${line}").`,
				pages: [entry[0].line.page]
			});
			return [];
		}
		const pieces = doc.pieces(entry.slice(k + 1).map((e) => e.line));
		const read = blocks(pieces);
		const data: FeatData = {
			category: m[1].toLowerCase().replace(' ', '-') as FeatData['category'],
			prerequisite: m[2] ?? null,
			repeatable: read.blocks.some((b) => b.name === 'Repeatable'),
			benefits: read.blocks
		};
		const text = [line, ...pieces.map((p) => p.text)];
		return [
			record(
				doc,
				'feat',
				name,
				data,
				text,
				entry.map((e) => e.line),
				entry[0].index
			)
		];
	});
}
