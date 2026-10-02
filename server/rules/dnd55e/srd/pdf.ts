// Reading the SRD's PDF into lines of text: each page's text items, in
// reading order (the left column top to bottom, then the right), grouped
// into lines, with the spaces the PDF leaves out between items put back,
// and each line keeping its spans (a change of font marks a run-in heading
// like "Multiattack." or a label like "Casting Time:"). The outline (the
// PDF's bookmarks) gives every page its section. Deterministic: the same
// file always reads to the same lines.

import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

export interface Span {
	text: string;
	/** The PDF font's id (for telling fonts apart; its name need not match its role). */
	font: string;
	x: number;
	width: number;
}

export interface Line {
	/** 1-based. */
	page: number;
	/** 0 left, 1 right; full-width lines count as the left. */
	column: 0 | 1;
	y: number;
	/** Text height of the line's first span. */
	size: number;
	/** Where the line's first span starts, and its last ends. */
	x: number;
	end: number;
	spans: Span[];
	text: string;
}

export interface Bookmark {
	title: string;
	/** The titles from the top of the outline down to this one. */
	path: string[];
	page: number;
}

export interface PdfText {
	pages: number;
	lines: Line[];
	outline: Bookmark[];
}

/** Lines lower than this (in PDF points from the bottom) are the page footer. */
const FOOTER_Y = 40;
/** Items this close vertically are on the same line. */
const SAME_LINE = 2.5;

export async function readPdf(bytes: Uint8Array): Promise<PdfText> {
	const task = getDocument({
		// A copy of our own: pdf.js transfers the buffer it is given.
		data: new Uint8Array(bytes),
		useSystemFonts: false,
		disableFontFace: true,
		verbosity: 0
	});
	const doc = await task.promise;
	const lines: Line[] = [];
	for (let p = 1; p <= doc.numPages; p++) {
		const page = await doc.getPage(p);
		const [, , width] = page.view;
		const content = await page.getTextContent();
		const items: (Span & { y: number; size: number })[] = [];
		for (const item of content.items) {
			if (!('str' in item) || item.str === '') continue;
			const [, , , , x, y] = item.transform as number[];
			if (y < FOOTER_Y) continue;
			items.push({
				text: item.str,
				font: item.fontName,
				x,
				y,
				width: item.width,
				size: item.height
			});
		}
		lines.push(...toLines(p, width / 2, items));
		page.cleanup();
	}
	const outline = await bookmarks(doc);
	await task.destroy();
	return { pages: lines.length ? lines[lines.length - 1].page : 0, lines, outline };
}

function toLines(
	page: number,
	middle: number,
	items: (Span & { y: number; size: number })[]
): Line[] {
	const columns: [typeof items, typeof items] = [[], []];
	for (const it of items) columns[it.x < middle - 4 ? 0 : 1].push(it);
	const out: Line[] = [];
	columns.forEach((column, c) => {
		const sorted = [...column].sort((a, b) => b.y - a.y || a.x - b.x);
		let current: typeof items = [];
		const flush = () => {
			if (!current.length) return;
			const spans = current
				.sort((a, b) => a.x - b.x)
				.map(({ text, font, x, width }) => ({ text, font, x, width }));
			const text = joinSpans(spans);
			if (text.trim())
				out.push({
					page,
					column: c as 0 | 1,
					y: Math.round(current[0].y * 10) / 10,
					size: Math.round(current[0].size * 10) / 10,
					x: Math.round(spans[0].x * 10) / 10,
					end: Math.round(Math.max(...spans.map((s) => s.x + s.width)) * 10) / 10,
					spans,
					text
				});
			current = [];
		};
		for (const it of sorted) {
			if (current.length && Math.abs(current[0].y - it.y) > SAME_LINE) flush();
			current.push(it);
		}
		flush();
	});
	return out;
}

/** The spans' text, with a space wherever the PDF left a gap between items but no space character. */
export function joinSpans(spans: readonly Span[]): string {
	let text = '';
	let end = -Infinity;
	for (const s of spans) {
		const gap = s.x - end;
		if (text && gap > 0.8 && !/\s$/.test(text) && !/^\s/.test(s.text)) text += ' ';
		text += s.text;
		end = s.x + s.width;
	}
	return text.replace(/\s+/g, ' ').trim();
}

type Doc = Awaited<ReturnType<typeof getDocument>['promise']>;

async function bookmarks(doc: Doc): Promise<Bookmark[]> {
	const out: Bookmark[] = [];
	const walk = async (
		items: Awaited<ReturnType<Doc['getOutline']>>,
		path: string[]
	): Promise<void> => {
		for (const item of items ?? []) {
			let dest = item.dest;
			if (typeof dest === 'string') dest = await doc.getDestination(dest);
			const title = item.title.trim();
			if (Array.isArray(dest) && dest[0]) {
				const page = (await doc.getPageIndex(dest[0] as never)) + 1;
				out.push({ title, path: [...path, title], page });
			}
			await walk(item.items, dest ? [...path, title] : path);
		}
	};
	await walk(await doc.getOutline(), []);
	return out;
}
