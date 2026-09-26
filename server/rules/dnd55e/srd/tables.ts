// Tables that run across both columns of a page (the Weapons and Armor
// tables, a class's features table): the left half is read in order, and
// each of its lines is paired with the right-column line printed at the
// same height, if any. A left line without a partner is a category row
// ("Simple Melee Weapons") or a cell that wrapped; the caller knows which.

import type { SrdDocument } from './document';
import type { Line } from './pdf';

export interface TableRow {
	left: Line;
	right: Line | null;
	index: number;
}

/** Table lines are set smaller than the text (9.3 headings, 9.5 rows; a few rows read 0 high). */
const isTableLine = (l: Line) => l.size < 9.9;

/** The lines under a table's title line (its header row first), each with its right-column partner. */
export function tableRows(doc: SrdDocument, title: number): TableRow[] {
	const head = doc.lines[title];
	const rows: TableRow[] = [];
	for (let i = title + 1; i < doc.lines.length; i++) {
		const l = doc.lines[i];
		if (l.page !== head.page || l.column !== head.column || !isTableLine(l)) break;
		rows.push({ left: l, right: head.column === 0 ? partner(doc, l) : null, index: i });
	}
	return rows;
}

/** The right-column table line at the same height as a left-column one. */
export function partner(doc: SrdDocument, left: Line): Line | null {
	return (
		doc.lines.find(
			(r) => r.page === left.page && r.column === 1 && isTableLine(r) && Math.abs(r.y - left.y) <= 2
		) ?? null
	);
}

/** The index of a table's title line (10.5 pt) in a range, by its text. */
export function tableTitle(
	doc: SrdDocument,
	range: { start: number; end: number },
	title: string
): number {
	for (let i = range.start; i < range.end; i++) {
		const l = doc.lines[i];
		if (l.size > 10.2 && l.size < 10.8 && l.text === title) return i;
	}
	throw new Error(`The SRD has no table "${title}" there`);
}
