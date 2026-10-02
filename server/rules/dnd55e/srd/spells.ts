// Spells, from "Spells > Spell Descriptions": each is a 12 pt heading (the
// name), a line "Level 2 Evocation (Wizard)" or "Evocation Cantrip
// (Sorcerer, Wizard)" (it may wrap), the four fields Casting Time, Range,
// Components and Duration, then its description; "Using a Higher-Level
// Spell Slot." and "Cantrip Upgrade." paragraphs are kept apart too.

import type { CatalogRecord } from '../../../../src/lib/content/catalog';
import { repairCase, type SrdDocument } from './document';
import { labelled, record, slice } from './entries';
import type { Line } from './pdf';
import type { SpellData } from './records';

const SUBTITLE = /^(?:Level (\d) ([A-Z][a-z]+)|([A-Z][a-z]+) Cantrip) \((.+)\)$/;
const FIELDS = ['Casting Time', 'Range', 'Components', 'Duration'] as const;

export function parseSpells(doc: SrdDocument): CatalogRecord<'spell', SpellData>[] {
	const lines = slice(doc, doc.range(['Spells', 'Spell Descriptions']));
	// Where each spell starts: a heading whose next line (or two) is its level and school.
	const starts: { at: number; subtitle: string; used: number }[] = [];
	for (let k = 0; k + 1 < lines.length; k++) {
		const heading = lines[k].line;
		if (heading.size < 11.5 || heading.size > 12.5) continue;
		const one = lines[k + 1].line.text;
		const two = lines[k + 2] ? `${one} ${lines[k + 2].line.text}` : one;
		if (SUBTITLE.test(one)) starts.push({ at: k, subtitle: one, used: 2 });
		else if (/^(Level \d|[A-Z][a-z]+ Cantrip)/.test(one) && SUBTITLE.test(two))
			starts.push({ at: k, subtitle: two, used: 3 });
	}
	return starts.map((s, n) => {
		const end = n + 1 < starts.length ? starts[n + 1].at : lines.length;
		const entry = lines.slice(s.at, end);
		return spell(doc, entry, s.subtitle, s.used);
	});
}

function spell(
	doc: SrdDocument,
	entry: { line: Line; index: number }[],
	subtitle: string,
	used: number
): CatalogRecord<'spell', SpellData> {
	const raw = entry[0].line.text;
	const name = repairCase(raw);
	if (name !== raw)
		doc.note({
			kind: 'repaired',
			at: `spell ${name}`,
			message: `Heading read as "${raw}".`,
			pages: [entry[0].line.page]
		});
	const m = SUBTITLE.exec(subtitle)!;
	const level = m[1] ? Number(m[1]) : 0;
	const school = m[2] ?? m[3];
	const classes = m[4].split(',').map((c) => c.trim());

	// The fields, each possibly wrapping onto the next line, then the description.
	const fields: Record<string, string> = {};
	let k = used;
	let last: string | null = null;
	for (; k < entry.length; k++) {
		const line = entry[k].line;
		// The SRD writes "Component:" for a few spells.
		const typo = /^Component: /.test(line.text);
		const field = labelled(
			typo ? line.text.replace(/^Component:/, 'Components:') : line.text,
			FIELDS
		);
		if (typo)
			doc.note({
				kind: 'repaired',
				at: `spell ${name}`,
				message: 'Field labelled "Component:" read as Components.',
				pages: [line.page]
			});
		if (field) {
			fields[field.label] = field.value;
			last = field.label;
		} else if (last && line.size < 9.8) {
			// A field's value wrapping onto the next line (the fields are smaller than the text).
			fields[last] = doc.join(fields[last], line.text);
		} else break;
	}
	const body = entry.slice(k).map((e) => e.line);
	const paragraphs = doc.paragraphs(body);
	const pick = (lead: string) => {
		const i = paragraphs.findIndex((p) => p.startsWith(`${lead}.`));
		return i < 0 ? null : paragraphs[i].slice(lead.length + 1).trim();
	};
	const casting = fields['Casting Time'] ?? '';
	const ritual = / or Ritual$/.test(casting);
	const duration = fields.Duration ?? '';
	const concentration = /^Concentration, /.test(duration);
	const data: SpellData = {
		level,
		school,
		classes,
		castingTime: casting.replace(/ or Ritual$/, ''),
		ritual,
		range: fields.Range ?? '',
		components: components(fields.Components ?? ''),
		duration: concentration ? duration.replace(/^Concentration, /, '') : duration,
		concentration,
		higherLevels: pick('Using a Higher-Level Spell Slot'),
		cantripUpgrade: pick('Cantrip Upgrade')
	};
	for (const f of FIELDS)
		if (!fields[f])
			doc.note({
				kind: 'note',
				at: `spell ${name}`,
				message: `No ${f} field.`,
				pages: [entry[0].line.page]
			});
	return record(
		doc,
		'spell',
		name,
		data,
		paragraphs,
		entry.map((e) => e.line),
		entry[0].index
	);
}

/** "V, S, M (a bell and silver wire)": the parts, with the material in its parentheses. */
function components(text: string): SpellData['components'] {
	const material = /\bM \((.*)\)$/.exec(text);
	const plain = text.replace(/\(.*\)/, '');
	return {
		verbal: /\bV\b/.test(plain),
		somatic: /\bS\b/.test(plain),
		material: material ? material[1] : /\bM\b/.test(plain) ? '' : null
	};
}
