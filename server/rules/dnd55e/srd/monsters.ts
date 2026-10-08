// Monsters, from "Monsters A–Z" and "Animals": each stat block is a 15 pt
// name (under an 18 pt group title, "Black Dragons", when it is one of
// several), a size-type-alignment line, AC and Initiative, HP, Speed, the
// ability table (score, modifier, save), the detail lines (Skills, Senses,
// Languages, CR, …) and sections of named blocks (Traits, Actions, Bonus
// Actions, Reactions, Legendary Actions). A group's lore text between stat
// blocks is not part of any block.

import type { CatalogRecord } from '../../../../src/lib/content/catalog';
import { repairCase, type SrdDocument } from './document';
import { blocks, record, slice } from './entries';
import type { Line } from './pdf';
import type { AbilityLine, Block, MonsterData } from './records';

const NAME = 15;
const GROUP = 18;
const SECTIONS = {
	Traits: 'traits',
	Actions: 'actions',
	'Bonus Actions': 'bonusActions',
	Reactions: 'reactions',
	'Legendary Actions': 'legendaryActions'
} as const;
const DETAILS = [
	'Skills',
	'Resistances',
	'Vulnerabilities',
	'Immunities',
	'Gear',
	'Senses',
	'Languages',
	'CR'
] as const;
const SIZES = 'Tiny|Small|Medium|Large|Huge|Gargantuan';
const TYPE_LINE = new RegExp(`^((?:${SIZES})(?: or (?:${SIZES}))?) (.+), ([^,]+)$`);

const num = (s: string) => Number(s.replace(/[−–]/g, '-').replace(/,/g, ''));

export function parseMonsters(doc: SrdDocument): CatalogRecord<'monster', MonsterData>[] {
	const out: CatalogRecord<'monster', MonsterData>[] = [];
	for (const path of [['Monsters A–Z'], ['Animals']]) {
		const lines = slice(doc, doc.range(path));
		let group: string | null = null;
		for (let k = 0; k < lines.length; k++) {
			const { line } = lines[k];
			if (Math.round(line.size) === GROUP) {
				group = line.text;
				continue;
			}
			if (Math.round(line.size) !== NAME) continue;
			let end = k + 1;
			while (
				end < lines.length &&
				![NAME, GROUP].includes(Math.round(lines[end].line.size)) &&
				!(lines[end].line.size === 10 && lines[end - 1].line.size !== 10 && startsLore(lines, end))
			)
				end++;
			const block = monster(doc, lines.slice(k, end), group);
			if (block) out.push(block);
			k = end - 1;
		}
	}
	return out;
}

/** Lore text (10 pt) after a stat block, until the next heading. */
function startsLore(lines: { line: Line }[], at: number): boolean {
	return lines[at].line.size === 10;
}

function monster(
	doc: SrdDocument,
	entry: { line: Line; index: number }[],
	group: string | null
): CatalogRecord<'monster', MonsterData> | null {
	const raw = entry[0].line.text;
	const name = repairCase(raw);
	const pages = [entry[0].line.page];
	const at = `monster ${name}`;
	if (name !== raw) doc.note({ kind: 'repaired', at, message: `Heading read as "${raw}".`, pages });
	const lines = entry.slice(1).map((e) => e.line);
	const fail = (message: string) => {
		doc.note({ kind: 'skipped', at, message, pages });
		return null;
	};

	// The header: everything before the first section heading (12 pt).
	const firstSection = lines.findIndex((l) => l.size >= 11.5 && l.text in SECTIONS);
	const header = firstSection < 0 ? lines : lines.slice(0, firstSection);
	const typeLine = header[0]?.text ?? '';
	const t = TYPE_LINE.exec(typeLine);
	if (!t) return fail(`No size, type and alignment line (read "${typeLine}").`);

	// The fields, a label at the start of a line, the rest wrapping onto lines without one.
	const fields: Record<string, string> = {};
	let last: string | null = null;
	const abilityRows: string[] = [];
	for (const l of header.slice(1)) {
		if (l.size < 7) continue; // "MOD SAVE MOD SAVE MOD SAVE"
		if (/^(Str|Int)\s+\d/i.test(l.text)) {
			abilityRows.push(l.text);
			last = null;
			continue;
		}
		const m =
			/^(AC|HP|Speed|Skills|Resistances|Vulnerabilities|Immunities|Gear|Senses|Languages|CR)\s+(.*)$/.exec(
				l.text
			);
		if (m && !(m[1] in fields)) {
			fields[m[1]] = m[2];
			last = m[1];
		} else if (last) fields[last] = doc.join(fields[last], l.text);
		else doc.note({ kind: 'note', at, message: `Line not read: "${l.text}".`, pages: [l.page] });
	}
	const ac = /^(\d+)(?:.*?)\s+Initiative\s+([+−-]\d+)\s+\((\d+)\)$/.exec(fields.AC ?? '');
	const hp = /^(\d+)(?:\s+\((.+)\))?$/.exec(fields.HP ?? '');
	// "9 (XP 5,000; PB +4)", "14 (XP 11,500, or 13,000 in lair; PB +5)"; a few read "3 (700 XP; PB +2)".
	const cr =
		/^([\d/]+)\s+\((?:XP ([\d,]+)|([\d,]+) XP)(?:,? or ([\d,]+) in lair)?; PB ([+−-]\d+)\)$/.exec(
			fields.CR ?? ''
		);
	if (!ac) return fail(`AC and Initiative not read ("${fields.AC ?? ''}").`);
	if (!hp) return fail(`HP not read ("${fields.HP ?? ''}").`);
	if (!cr) return fail(`CR not read ("${fields.CR ?? ''}").`);

	const abilities = {} as MonsterData['abilities'];
	// A save printed without its sign ("Int 6 −2 2") is read as the modifier when it has the same size.
	const cells = /\b(Str|Dex|Con|Int|Wis|Cha)\s*(\d+)\s+([+−-]\d+)\s+([+−-]?\d+)/gi;
	for (const row of abilityRows) {
		for (const m of row.matchAll(cells)) {
			const key = m[1].toLowerCase() as keyof MonsterData['abilities'];
			const modifier = num(m[3]);
			let save = num(m[4]);
			if (/^\d/.test(m[4])) {
				if (Math.abs(modifier) === save) save = modifier;
				doc.note({
					kind: 'repaired',
					at,
					message: `${m[1]} save printed without a sign ("${m[4]}"); read as ${save}.`,
					pages
				});
			}
			abilities[key] = { score: num(m[2]), modifier, save } satisfies AbilityLine;
		}
	}
	if (Object.keys(abilities).length !== 6) return fail('The ability table was not read whole.');

	// The sections and their blocks.
	const data: MonsterData = {
		group: group && group !== name ? group : null,
		size: t[1],
		type: t[2],
		alignment: t[3],
		armorClass: num(ac[1]),
		initiative: { bonus: num(ac[2]), score: num(ac[3]) },
		hitPoints: { average: num(hp[1]), formula: hp[2] ?? null },
		speed: fields.Speed ?? '',
		abilities,
		details: Object.fromEntries(
			DETAILS.filter((d) => d !== 'CR' && fields[d]).map((d) => [d, fields[d]])
		),
		challenge: {
			rating: cr[1],
			xp: num(cr[2] ?? cr[3]),
			xpInLair: cr[4] ? num(cr[4]) : null,
			proficiencyBonus: num(cr[5])
		},
		traits: [],
		actions: [],
		bonusActions: [],
		reactions: [],
		legendaryActions: [],
		notes: {}
	};
	const text: string[] = [header.map((l) => l.text).join('\n')];
	if (firstSection >= 0) {
		let k = firstSection;
		while (k < lines.length) {
			const heading = lines[k].text as keyof typeof SECTIONS;
			let end = k + 1;
			while (end < lines.length && !(lines[end].size >= 11.5 && lines[end].text in SECTIONS)) end++;
			const pieces = doc.pieces(lines.slice(k + 1, end));
			const paragraphs = pieces.map((p) => p.text);
			const read = blocks(pieces);
			(data[SECTIONS[heading]] as Block[]).push(...read.blocks);
			if (read.lead.length) data.notes[heading] = read.lead.join('\n\n');
			text.push(heading, ...paragraphs);
			k = end;
		}
	}
	return record(
		doc,
		'monster',
		name,
		data,
		text,
		entry.map((e) => e.line),
		entry[0].index
	);
}
