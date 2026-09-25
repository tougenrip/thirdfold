// Shared by the parsers: turning a run of lines into a record with its id,
// text and provenance, and splitting a record's paragraphs into run-in
// blocks ("Darkvision. You have …").

import { recordId, type CatalogRecord } from '../../../../src/lib/content/catalog';
import type { Paragraph, SrdDocument } from './document';
import type { Line } from './pdf';
import type { Block } from './records';
import { SRD_521 } from './source';

/** A record of the SRD: its id from kind and name, its text, and where it came from. */
export function record<K extends string, D>(
	doc: SrdDocument,
	kind: K,
	name: string,
	data: D,
	text: string[],
	lines: readonly Line[],
	first: number,
	/** What the id is made from, when the name alone isn't unique ("Weapon Property Reach"). */
	idName = name
): CatalogRecord<K, D> {
	return {
		id: recordId(SRD_521.id, kind, idName),
		kind,
		name,
		data,
		text: text.join('\n\n'),
		provenance: {
			source: SRD_521.id,
			section: doc.sectionOf(first),
			pages: [...new Set(lines.map((l) => l.page))].sort((a, b) => a - b)
		}
	};
}

/**
 * Paragraphs that open with a run-in heading ("Darkvision. You have …") as
 * named blocks; a paragraph without one joins the block before it, or,
 * before any block, is lead text.
 */
export function blocks(paragraphs: readonly Paragraph[]): { lead: string[]; blocks: Block[] } {
	const lead: string[] = [];
	const out: Block[] = [];
	for (const p of paragraphs) {
		if (p.head !== null && p.text.startsWith(`${p.head}.`))
			out.push({ name: p.head, text: p.text.slice(p.head.length + 1).trim() });
		else if (out.length) out[out.length - 1].text += `\n\n${p.text}`;
		else lead.push(p.text);
	}
	return { lead, blocks: out };
}

/** "Label: value" at the start of a line, where the label is one of these. */
export function labelled(
	text: string,
	labels: readonly string[]
): { label: string; value: string } | null {
	for (const label of labels) {
		if (text.startsWith(`${label}:`)) return { label, value: text.slice(label.length + 1).trim() };
	}
	return null;
}

/** Lines of a range, as an array with each line's index. */
export function slice(
	doc: SrdDocument,
	range: { start: number; end: number }
): { line: Line; index: number }[] {
	return doc.lines
		.slice(range.start, range.end)
		.map((line, k) => ({ line, index: range.start + k }));
}
