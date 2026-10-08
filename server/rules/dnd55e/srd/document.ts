// The SRD as a document: its lines in reading order, each line's section
// (the outline's bookmarks, anchored to the heading lines they name), and
// the means to read runs of lines back into paragraphs: joining lines,
// undoing the hyphens typesetting put at line ends (a word stays hyphenated
// only where the SRD hyphenates it elsewhere), and splitting paragraphs
// where a line stops short or a run-in heading or bullet begins.

import type { Bookmark, Line, PdfText } from './pdf';

export interface Section {
	path: string[];
	/** Index of its heading line. */
	start: number;
}

/** A paragraph, and the run-in heading it opens with, if any. */
export interface Paragraph {
	text: string;
	head: string | null;
}

export interface Diagnostic {
	/** What the importer made of it: `skipped` (not imported), `repaired` (text corrected), `unanchored`. */
	kind: 'skipped' | 'repaired' | 'unanchored' | 'note';
	/** Where: a section or record. */
	at: string;
	message: string;
	pages?: number[];
}

const norm = (s: string) =>
	s
		.toLowerCase()
		.replace(/[‘’]/g, "'")
		.replace(/[“”]/g, '"')
		.replace(/[–—]/g, '-')
		.replace(/\s+/g, ' ')
		.trim();

/** Right edge of a text column: a line ending this far short of it ends a paragraph. */
const SHORT_BY = 24;

export class SrdDocument {
	readonly lines: readonly Line[];
	readonly sections: readonly Section[];
	readonly diagnostics: Diagnostic[] = [];
	private readonly words: Set<string>;
	private readonly rightEdge: Map<string, number>;

	constructor(pdf: PdfText) {
		this.lines = pdf.lines;
		this.sections = this.anchor(pdf.outline);
		this.words = new Set();
		for (const l of this.lines) {
			const tokens = l.text.split(/\s+/);
			// The last token may be a line-end hyphenation; every other one is a real word.
			for (const t of tokens.slice(0, -1))
				this.words.add(t.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '').toLowerCase());
		}
		this.rightEdge = new Map();
		for (const l of this.lines) {
			const key = `${l.page}.${l.column}`;
			this.rightEdge.set(key, Math.max(this.rightEdge.get(key) ?? 0, l.end));
		}
	}

	private anchor(outline: readonly Bookmark[]): Section[] {
		const out: Section[] = [];
		let from = 0;
		for (const b of outline) {
			// A heading may wrap onto two or three lines, and a comma name may be turned around
			// ("Crawling Claws, Swarm of" is headed "Swarm of Crawling Claws").
			const title = norm(b.title);
			const turned = /^(.+), (.+)$/.exec(title);
			const wants = turned ? [title, `${turned[2]} ${turned[1]}`] : [title];
			let found = -1;
			for (let i = from; i < this.lines.length && found < 0; i++) {
				const l = this.lines[i];
				if (l.page > b.page + 2) break;
				if (l.page < b.page - 1 || l.size < 10.5) continue;
				let text = '';
				for (let n = 0; n < 3 && i + n < this.lines.length; n++) {
					const next = this.lines[i + n];
					if (n > 0 && (next.size !== l.size || next.page !== l.page)) break;
					text = norm(`${text} ${next.text}`);
					if (wants.includes(text)) {
						found = i;
						break;
					}
				}
			}
			if (found < 0) {
				this.diagnostics.push({
					kind: 'unanchored',
					at: b.path.join(' > '),
					message: 'No heading line for this bookmark; its lines count as the section before it.',
					pages: [b.page]
				});
				continue;
			}
			out.push({ path: b.path, start: found });
			from = found;
		}
		return out;
	}

	/** The section a line is in. */
	sectionOf(index: number): string[] {
		let path: string[] = [];
		for (const s of this.sections) {
			if (s.start > index) break;
			path = s.path;
		}
		return path;
	}

	/** The lines of a section and everything under it: from its heading to the next section outside it. */
	range(path: readonly string[]): { start: number; end: number } {
		const key = path.join('\u0000');
		const i = this.sections.findIndex((s) => s.path.join('\u0000') === key);
		if (i < 0) throw new Error(`The SRD has no section ${path.join(' > ')}`);
		const start = this.sections[i].start;
		let end = this.lines.length;
		for (const s of this.sections.slice(i + 1)) {
			const inside = s.path.length > path.length && path.every((p, k) => s.path[k] === p);
			if (!inside) {
				end = s.start;
				break;
			}
		}
		return { start, end };
	}

	/** Whether a line stops well short of its column's right edge (the end of a paragraph). */
	short(line: Line): boolean {
		return line.end < (this.rightEdge.get(`${line.page}.${line.column}`) ?? line.end) - SHORT_BY;
	}

	/** Two lines' text joined: a line-end hyphen is kept only where the SRD writes the word hyphenated. */
	join(text: string, next: string): string {
		const m = /([\p{L}]+)-$/u.exec(text);
		const head = /^([\p{L}]+)/u.exec(next);
		if (m && head) {
			const joined = (m[1] + head[1]).toLowerCase();
			const hyphenated = `${m[1]}-${head[1]}`.toLowerCase();
			if (/^\p{Lu}/u.test(head[1]) || (this.words.has(hyphenated) && !this.words.has(joined)))
				return text + next;
			return text.slice(0, -1) + next;
		}
		return `${text} ${next}`;
	}

	/**
	 * Lines read as paragraphs: a paragraph ends where a line stops short
	 * after a sentence or changes size (a table row, a sidebar), and a new
	 * one starts at a bullet, a label ("At Will:") or a run-in heading
	 * (a first span in another font ending with a full stop).
	 */
	paragraphs(lines: readonly Line[]): string[] {
		return this.pieces(lines).map((p) => p.text);
	}

	/** Paragraphs with the run-in heading each opens with ("Multiattack"), or null. */
	pieces(lines: readonly Line[]): Paragraph[] {
		const out: Paragraph[] = [];
		let current: Paragraph | null = null;
		let previous: Line | null = null;
		for (const line of lines) {
			const head = runIn(line);
			const breaks =
				!previous ||
				previous.size !== line.size ||
				(this.short(previous) && /[.!?:)”]$/.test(previous.text)) ||
				/^[•●]/.test(line.text) ||
				// A heading or label comes after a finished sentence; a line after a label ending
				// its line ("Dexterity Saving Throw:") is that label's value.
				(/[.!?”]$/.test(previous.text) && (head !== null || label(line) !== null));
			if (breaks || !current) {
				if (current) out.push(current);
				current = {
					text: line.text,
					head: !previous || /[.!?”]$/.test(previous.text) ? head : null
				};
			} else current.text = this.join(current.text, line.text);
			previous = line;
		}
		if (current) out.push(current);
		return out;
	}

	/** Lines read as one run of text (a table cell, a value that wraps). */
	text(lines: readonly Line[]): string {
		return lines.map((l) => l.text).reduce((a, b) => (a ? this.join(a, b) : b), '');
	}

	note(d: Diagnostic): void {
		this.diagnostics.push(d);
	}
}

/** A line's first two spans with text (the PDF puts spaces in spans of their own). */
function leading(line: Line) {
	return line.spans.filter((s) => s.text.trim() !== '');
}

/** A run-in heading: the line's first span, in a font of its own, ends with a full stop ("Multiattack."). */
export function runIn(line: Line): string | null {
	const [first, second] = leading(line);
	if (!first || !second || first.font === second.font) return null;
	const title = first.text.trim();
	return /^[\p{Lu}][^.]{0,60}\.$/u.test(title) ? title.slice(0, -1) : null;
}

/** A label in a font of its own at the start of a line ("At Will:", "1/Day Each:"). */
export function label(line: Line): string | null {
	const [first, second] = leading(line);
	if (!first || !second || first.font === second.font) return null;
	const title = first.text.trim();
	return /^[\p{Lu}\d][^:]{0,40}:$/u.test(title) ? title.slice(0, -1) : null;
}

/**
 * A heading whose letters came out with their case scrambled by the PDF's
 * small-capitals font ("Acid SplASh"): each word capitalized as a title.
 */
export function repairCase(name: string): string {
	return name
		.split(' ')
		.map((w) => (/\p{Ll}\p{Lu}/u.test(w) ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
		.join(' ');
}

export { norm };
