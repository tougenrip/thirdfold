// Rules terms: the Rules Glossary's entries ("Blinded [Condition]",
// "Attack [Action]", "Advantage"), each a 12 pt heading with an optional
// tag, and the weapon properties and mastery properties described in
// "Equipment > Weapons" (tagged "Weapon Property" and "Mastery Property").

import type { CatalogRecord } from '../../../../src/lib/content/catalog';
import type { SrdDocument } from './document';
import { record, slice } from './entries';
import type { RuleData } from './records';

const HEADING = /^(.+?)(?: \[([A-Za-z ]+)\])?$/;

export function parseRules(doc: SrdDocument): CatalogRecord<'rule', RuleData>[] {
	const out: CatalogRecord<'rule', RuleData>[] = [];
	const glossary = slice(doc, doc.range(['Rules Glossary']));
	const start = glossary.findIndex((l) => l.line.text === 'Rules Definitions');
	out.push(...terms(doc, glossary.slice(start + 1), () => null));

	// Weapon properties, then mastery properties, each a 12 pt heading under its 14 pt one.
	const weapons = slice(doc, doc.range(['Equipment', 'Weapons']));
	const props = weapons.findIndex((l) => l.line.size > 13 && l.line.text === 'Properties');
	const mastery = weapons.findIndex(
		(l) => l.line.size > 13 && l.line.text === 'Mastery Properties'
	);
	if (props < 0 || mastery < 0) {
		doc.note({
			kind: 'skipped',
			at: 'Equipment > Weapons',
			message: 'Weapon or mastery properties not found.'
		});
		return out;
	}
	out.push(...terms(doc, weapons.slice(props + 1, mastery), () => 'Weapon Property'));
	const end = weapons.findIndex((l, k) => k > mastery && l.line.size > 10.2 && l.line.size < 10.8);
	out.push(
		...terms(doc, weapons.slice(mastery + 1, end < 0 ? undefined : end), () => 'Mastery Property')
	);
	return out;
}

/** Entries under 12 pt headings, up to the next heading of that size or larger; sidebars left out. */
function terms(
	doc: SrdDocument,
	lines: ReturnType<typeof slice>,
	tagOf: () => string | null
): CatalogRecord<'rule', RuleData>[] {
	const heads = lines.flatMap((l, k) => (l.line.size > 11.5 && l.line.size < 12.5 ? [k] : []));
	return heads.map((h, n) => {
		let end = n + 1 < heads.length ? heads[n + 1] : lines.length;
		for (let k = h + 1; k < end; k++) if (lines[k].line.size > 12.5) end = k;
		const m = HEADING.exec(lines[h].line.text)!;
		const body = lines
			.slice(h + 1, end)
			.map((l) => l.line)
			// Sidebars (an 11 pt title over 9 pt text) are the book's asides, not the term.
			.filter((l) => l.size >= 9.2 && Math.abs(l.size - 11) > 0.2);
		const text = doc.paragraphs(body);
		const data: RuleData = { tag: m[2] ?? tagOf() };
		// A property shares its name with a glossary term ("Reach"): its id says which it is.
		const idName = tagOf() ? `${tagOf()} ${m[1]}` : m[1];
		return record(
			doc,
			'rule',
			m[1],
			data,
			text,
			lines.slice(h, end).map((l) => l.line),
			lines[h].index,
			idName
		);
	});
}
