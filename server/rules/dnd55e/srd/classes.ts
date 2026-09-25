// Classes and their subclasses, from "Classes": each class has its Core
// Traits table (Primary Ability, Hit Point Die, Saving Throws, skills,
// weapons, tools, armor, starting equipment), its Features table (level,
// Proficiency Bonus, features, and the class's own columns such as Rages or
// spell slots), its features ("Level 2: Action Surge"), and one subclass
// ("Fighter Subclass: Champion") with features of its own.

import type { CatalogRecord } from '../../../../src/lib/content/catalog';
import type { SrdDocument } from './document';
import { record, slice } from './entries';
import type { Line, Span } from './pdf';
import type { ClassData, ClassLevel, SubclassData } from './records';
import { partner, tableRows, tableTitle } from './tables';

const CLASSES = [
	'Barbarian',
	'Bard',
	'Cleric',
	'Druid',
	'Fighter',
	'Monk',
	'Paladin',
	'Ranger',
	'Rogue',
	'Sorcerer',
	'Warlock',
	'Wizard'
];

const TRAITS = [
	'Primary Ability',
	'Hit Point Die',
	'Saving Throw Proficiencies',
	'Saving Throws',
	'Saving Throw',
	'Skill Proficiencies',
	'Weapon Proficiencies',
	'Tool Proficiencies',
	'Armor Training',
	'Starting Equipment'
];

const FEATURE = /^Level (\d+): (.+)$/;

export function parseClasses(
	doc: SrdDocument
): (CatalogRecord<'class', ClassData> | CatalogRecord<'subclass', SubclassData>)[] {
	return CLASSES.flatMap((name) => parseClass(doc, name));
}

function parseClass(
	doc: SrdDocument,
	name: string
): (CatalogRecord<'class', ClassData> | CatalogRecord<'subclass', SubclassData>)[] {
	const range = doc.range(['Classes', name]);
	const at = `class ${name}`;
	const traits = coreTraits(doc, tableTitle(doc, range, `Core ${name} Traits`));
	const { levels, rows } = featureTable(doc, tableTitle(doc, range, `${name} Features`), at);

	// Features, then the subclass (its heading is 14 pt or larger: "Fighter Subclass: Champion").
	const lines = slice(doc, range);
	const sub = lines.findIndex((l, k) => l.line.size >= 13.5 && isSubclassHeading(lines, k, name));
	const classLines = sub < 0 ? lines : lines.slice(0, sub);
	const features = levelFeatures(doc, classLines);
	const out: (CatalogRecord<'class', ClassData> | CatalogRecord<'subclass', SubclassData>)[] = [];
	const data: ClassData = {
		primaryAbility: traits['Primary Ability'] ?? '',
		hitDie: (traits['Hit Point Die'] ?? '').replace(/ per .*$/, ''),
		savingThrows: (
			traits['Saving Throw Proficiencies'] ??
			traits['Saving Throws'] ??
			traits['Saving Throw'] ??
			''
		)
			.split(/ and |, /)
			.map((s) => s.trim())
			.filter(Boolean),
		skills: traits['Skill Proficiencies'] ?? '',
		weapons: traits['Weapon Proficiencies'] ?? '',
		tools: traits['Tool Proficiencies'] ?? null,
		armor: traits['Armor Training'] ?? '',
		equipment: traits['Starting Equipment'] ?? '',
		levels,
		features: features.blocks
	};
	for (const t of [
		'Primary Ability',
		'Hit Point Die',
		'Skill Proficiencies',
		'Armor Training',
		'Starting Equipment'
	])
		if (!traits[t])
			doc.note({
				kind: 'note',
				at,
				message: `No ${t} in the Core Traits table.`,
				pages: [lines[0].line.page]
			});
	if (levels.length !== 20)
		doc.note({
			kind: 'note',
			at,
			message: `Features table has ${levels.length} levels.`,
			pages: [lines[0].line.page]
		});
	const text = [...Object.entries(traits).map(([k, v]) => `${k}: ${v}`), ...features.text];
	out.push(
		record(doc, 'class', name, data, text, [...classLines.map((l) => l.line), ...rows], range.start)
	);

	if (sub >= 0) {
		const heading = subclassName(lines, sub, name);
		const subLines = lines.slice(sub);
		const f = levelFeatures(doc, subLines);
		out.push(
			record(
				doc,
				'subclass',
				heading,
				{ class: name, features: f.blocks },
				f.text,
				subLines.map((l) => l.line),
				subLines[0].index
			)
		);
	} else doc.note({ kind: 'note', at, message: 'No subclass found.', pages: [lines[0].line.page] });
	return out;
}

function isSubclassHeading(lines: { line: Line }[], k: number, name: string): boolean {
	const text = lines[k].line.text;
	return text.startsWith(`${name} Subclass:`);
}

/** "Fighter Subclass: Champion", the name perhaps on the next line. */
function subclassName(lines: { line: Line }[], k: number, name: string): string {
	let text = lines[k].line.text;
	// The heading may wrap onto the next line(s), set the same size.
	for (let n = k + 1; n < k + 3 && lines[n] && lines[n].line.size === lines[k].line.size; n++)
		text = `${text} ${lines[n].line.text}`;
	return text.replace(`${name} Subclass: `, '');
}

/** The Core Traits table: a label at the start of a row, its value wrapping onto the rows after. */
function coreTraits(doc: SrdDocument, title: number): Record<string, string> {
	const out: Record<string, string> = {};
	let last: string | null = null;
	for (const row of tableRows(doc, title)) {
		const text = row.left.text;
		const label = TRAITS.find((t) => text === t || text.startsWith(`${t} `));
		if (label) {
			out[label] = text.slice(label.length).trim();
			last = label;
		} else if (text === 'Proficiencies') continue;
		else if (last) out[last] = doc.join(out[last], text);
	}
	return out;
}

/** Words of a span with where each is (spread over the span's width by character). */
function words(span: Span): { text: string; x: number }[] {
	const out: { text: string; x: number }[] = [];
	for (const m of span.text.matchAll(/\S+/g)) {
		const mid = (m.index + m[0].length / 2) / Math.max(1, span.text.length);
		out.push({ text: m[0], x: span.x + span.width * mid });
	}
	return out;
}

/**
 * The Features table: each row's level, Proficiency Bonus and features on
 * the left (features may wrap onto a row of their own), and the class's own
 * columns, matched to the headings above them by where they stand.
 */
function featureTable(
	doc: SrdDocument,
	title: number,
	at: string
): { levels: ClassLevel[]; rows: Line[] } {
	const rows = tableRows(doc, title);
	const first = rows.findIndex((r) => /^\d+ \+\d/.test(r.left.text));
	if (first < 0) {
		doc.note({
			kind: 'skipped',
			at,
			message: 'Features table not read.',
			pages: [doc.lines[title].page]
		});
		return { levels: [], rows: [] };
	}
	const header = rows.slice(0, first);
	const firstRow = rows[first].left;
	// Column headings: words right of "Class Features" on the left, and the right column's
	// heading lines between the title and the first row (group titles like
	// "——Spell Slots per Spell Level——" are not columns).
	const headingWords: { text: string; x: number; y: number }[] = [];
	const featuresSpan = header.flatMap((h) => h.left.spans).find((s) => s.text.includes('Features'));
	const featuresEnd = featuresSpan ? featuresSpan.x + featuresSpan.width : Infinity;
	for (const h of header)
		for (const s of h.left.spans)
			for (const w of words(s)) if (w.x > featuresEnd) headingWords.push({ ...w, y: h.left.y });
	const top = doc.lines[title].y;
	for (const l of doc.lines)
		if (
			l.page === firstRow.page &&
			l.column === 1 &&
			l.size < 9.9 &&
			l.y < top &&
			l.y > firstRow.y + 1.5
		)
			for (const s of l.spans)
				if (!/—|Spell Slots|per Spell|Level—/.test(s.text))
					for (const w of words(s)) headingWords.push({ ...w, y: l.y });
	// Words stacked at about the same place are one heading ("Second" over "Wind").
	const columns: { name: string; x: number; y: number }[] = [];
	for (const w of headingWords.sort((a, b) => b.y - a.y || a.x - b.x)) {
		const col = columns.find((c) => c.y !== w.y && Math.abs(c.x - w.x) < 20);
		if (col) {
			col.name = `${col.name} ${w.text}`;
			col.y = w.y;
		} else columns.push({ name: w.text, x: w.x, y: w.y });
	}
	columns.sort((a, b) => a.x - b.x);
	// The spell slot columns are headed by level alone, under "Spell Slots per Spell Level".
	for (const c of columns) if (/^\d$/.test(c.name)) c.name = `Spell Slots ${c.name}`;
	// Columns whose headings stand in the left half have their values in the left row too.
	const middle =
		doc.lines[title].column === 0
			? Math.min(
					...doc.lines.filter((l) => l.page === firstRow.page && l.column === 1).map((l) => l.x)
				)
			: Infinity;
	const leftColumns = columns.filter((c) => c.x < middle);
	const leftStart = leftColumns.length ? Math.min(...leftColumns.map((c) => c.x)) - 10 : Infinity;
	const nearest = (list: typeof columns, x: number) =>
		list.reduce((best, c) => (Math.abs(c.x - x) < Math.abs(best.x - x) ? c : best));
	const levels: ClassLevel[] = [];
	const used: Line[] = [...header.map((h) => h.left)];
	for (const row of rows.slice(first)) {
		// Words under a left-half column are its values; the rest is the level, bonus and features.
		const leftWords = row.left.spans.flatMap(words);
		const own = leftWords
			.filter((w) => w.x < leftStart)
			.map((w) => w.text)
			.join(' ');
		const m = /^(\d+) \+(\d)(?: (.+))?$/.exec(own);
		if (!m) {
			// A features cell that wrapped onto its own line.
			const last = levels.at(-1);
			if (last) {
				const joined = doc.join(last.features.join(', '), own || row.left.text);
				last.features = joined.split(/, (?![^(]*\))/).map((f) => f.trim());
			}
			used.push(row.left);
			continue;
		}
		const values: Record<string, string> = {};
		const put = (name: string, text: string) =>
			(values[name] = values[name] ? `${values[name]} ${text}` : text);
		const inLeft = leftWords.filter((w) => w.x >= leftStart);
		for (const w of inLeft) put(nearest(leftColumns, w.x).name, w.text);
		const right = row.right ?? partner(doc, row.left);
		const rightColumns = columns.filter((c) => c.x >= middle);
		if (right && rightColumns.length) {
			for (const w of right.spans.flatMap(words)) put(nearest(rightColumns, w.x).name, w.text);
			used.push(right);
		}

		used.push(row.left);
		levels.push({
			level: Number(m[1]),
			proficiencyBonus: Number(m[2]),
			features: (m[3] ?? '')
				.split(/, (?![^(]*\))/)
				.map((f) => f.trim())
				.filter((f) => f && f !== '—'),
			columns: values
		});
	}
	// A heading word that never has a value under it is part of its neighbour's heading
	// ("Sneak" over "Attack", set too far apart to stack).
	const valued = columns.filter((c) => levels.some((l) => c.name in l.columns));
	for (const frag of columns.filter((c) => !valued.includes(c))) {
		if (!valued.length) break;
		const target = nearest(valued, frag.x);
		const name = frag.x < target.x ? `${frag.name} ${target.name}` : `${target.name} ${frag.name}`;
		for (const l of levels)
			if (target.name in l.columns) {
				l.columns[name] = l.columns[target.name];
				delete l.columns[target.name];
			}
		target.name = name;
	}
	for (const l of levels) {
		const empty = valued.filter((c) => !(c.name in l.columns)).map((c) => c.name);
		if (empty.length)
			doc.note({
				kind: 'note',
				at,
				message: `Level ${l.level}: no value under ${empty.join(', ')}.`
			});
		// Keep each level's columns in the table's order.
		l.columns = Object.fromEntries(
			valued.flatMap((c) => (c.name in l.columns ? [[c.name, l.columns[c.name]]] : []))
		);
	}
	return { levels, rows: used };
}

/** "Level 3: Name" features, each up to the next. */
function levelFeatures(
	doc: SrdDocument,
	lines: { line: Line; index: number }[]
): { blocks: ClassData['features']; text: string[] } {
	const blocks: ClassData['features'] = [];
	const text: string[] = [];
	const heads = lines.flatMap((l, k) =>
		l.line.size > 11.5 && l.line.size < 12.5 && FEATURE.test(l.line.text) ? [k] : []
	);
	heads.forEach((h, n) => {
		const end = n + 1 < heads.length ? heads[n + 1] : lines.length;
		const m = FEATURE.exec(lines[h].line.text)!;
		// A feature's text: its paragraphs, leaving out tables and sidebars set smaller.
		const body = lines
			.slice(h + 1, end)
			.map((l) => l.line)
			.filter((l) => l.size >= 9.9 && l.size < 11);
		const paragraphs = doc.paragraphs(body);
		blocks.push({ level: Number(m[1]), name: m[2], text: paragraphs.join('\n\n') });
		text.push(lines[h].line.text, ...paragraphs);
	});
	return { blocks, text };
}
