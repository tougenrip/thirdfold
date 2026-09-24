// The builder's working copy of an adventure file: kept in this browser as
// it is edited, and the small conversions its forms need (cells written as
// "x,y", lists written with commas). Pure, so it is tested without a page.

import { exampleAdventure } from '$lib/adventure/example';
import type { AdventureFile } from '$lib/adventure/file';
import type { Effect, Rule, When } from '$lib/adventure/define';
import { blankScene } from '$lib/game/scene-file';
import type { GridPos } from '$lib/game/grid';

const STORAGE_KEY = 'thirdfold:builder';

/** A type with every list and field writable, all the way down: the builder edits in place. */
export type DeepMutable<T> = T extends (...args: never[]) => unknown
	? T
	: T extends readonly (infer U)[]
		? DeepMutable<U>[]
		: T extends object
			? { -readonly [K in keyof T]: DeepMutable<T[K]> }
			: T;

/** The adventure file the builder is editing. */
export type Draft = DeepMutable<AdventureFile>;
export type DraftEffect = DeepMutable<Effect>;
export type DraftRule = DeepMutable<Rule>;
export type DraftWhen = DeepMutable<When>;

/** A checked file, to edit. */
export const toDraft = (file: AdventureFile): Draft => file as Draft;

/** The draft this browser was working on, or the example to start from. */
export function loadDraft(): Draft {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (raw) return JSON.parse(raw) as Draft;
	} catch {
		// A private window, or storage turned off: start from the example.
	}
	return toDraft(exampleAdventure());
}

export function storeDraft(draft: Draft): void {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
	} catch {
		// Too large, or storage turned off: the draft still lives in the page (and in an exported file).
	}
}

/** A copy without one field (an optional field cleared). */
export function without<T extends object, K extends keyof T>(o: T, key: K): Omit<T, K> {
	const copy = { ...o };
	delete copy[key];
	return copy;
}

/** A cell as the forms write it: `x,y`. */
export function formatCell(c: GridPos): string {
	return `${c.x},${c.y}`;
}

export function parseCell(text: string): GridPos | null {
	const m = /^\s*(\d{1,2})\s*,\s*(\d{1,2})\s*$/.exec(text);
	return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
}

/** Cells as the forms write them: `x,y; x,y`. */
export function formatCells(cells: readonly GridPos[]): string {
	return cells.map(formatCell).join('; ');
}

export function parseCells(text: string): GridPos[] | null {
	if (!text.trim()) return [];
	const cells = text.split(';').map(parseCell);
	return cells.every((c) => c) ? (cells as GridPos[]) : null;
}

/** An area as the forms write it: `x,y to x,y`. */
export function formatArea(a: { from: GridPos; to: GridPos }): string {
	return `${formatCell(a.from)} to ${formatCell(a.to)}`;
}

export function parseArea(text: string): { from: GridPos; to: GridPos } | null {
	const [a, b] = text.split(/\s+to\s+/i);
	const from = a ? parseCell(a) : null;
	const to = b ? parseCell(b) : from;
	return from && to ? { from, to } : null;
}

/** A list as the forms write it: `a, b, c`. */
export function formatList(items: readonly string[] | undefined): string {
	return (items ?? []).join(', ');
}

export function parseList(text: string): string[] {
	return text
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
}

/** An id made from a name: lower case, words joined by `_`. */
export function idFrom(name: string, taken: Iterable<string> = []): string {
	const base =
		name
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '_')
			.replace(/^_+|_+$/g, '')
			.slice(0, 40) || 'item';
	const used = new Set(taken);
	if (!used.has(base)) return base;
	for (let i = 2; ; i++) if (!used.has(`${base}_${i}`)) return `${base}_${i}`;
}

/** Renames a key of a record, keeping its place (references elsewhere are the checker's to report). */
export function renameKey<T>(
	record: Record<string, T>,
	from: string,
	to: string
): Record<string, T> {
	if (from === to || !to || Object.hasOwn(record, to)) return record;
	return Object.fromEntries(Object.entries(record).map(([k, v]) => [k === from ? to : k, v]));
}

/** A new, empty table for a location. */
export function newTable(name: string, width = 16, height = 12, environment: string | null = null) {
	return blankScene(name, width, height, environment);
}

/** How the story moves: each chapter to the next by its event, and choices that jump elsewhere. */
export interface FlowStep {
	from: string;
	to: string | null;
	/** What moves it on: an event, or a choice's answer. */
	by: string;
	kind: 'next' | 'branch';
}

export function flowOf(file: AdventureFile): FlowStep[] {
	const steps: FlowStep[] = Object.entries(file.chapters).map(([id, c]) => ({
		from: id,
		to: c.next.to,
		by: c.next.on,
		kind: 'next'
	}));
	// Choices that enter a chapter directly branch off the one where they are offered.
	for (const [decisionId, d] of Object.entries(file.decisions)) {
		const offeredIn = Object.entries(file.chapters).find(([, c]) =>
			mentions(c.opening ?? [], (e) => 'offer' in e && e.offer === decisionId)
		)?.[0];
		for (const o of d.options) {
			const entered = findEffect(o.does, (e) => 'enter' in e);
			if (entered && 'enter' in entered) {
				steps.push({
					from: offeredIn ?? '(a choice)',
					to: entered.enter,
					by: `${decisionId}: ${o.label}`,
					kind: 'branch'
				});
			}
		}
	}
	return steps;
}

function findEffect(effects: readonly Effect[], test: (e: Effect) => boolean): Effect | undefined {
	for (const e of effects) {
		if (test(e)) return e;
		if ('rules' in e) {
			for (const r of e.rules) {
				const found = findEffect(r.do, test);
				if (found) return found;
			}
		}
	}
	return undefined;
}

const mentions = (effects: readonly Effect[], test: (e: Effect) => boolean) =>
	findEffect(effects, test) !== undefined;

/** Every id used anywhere of a kind, for pickers: events, clues, objects... */
export function idsOf(file: AdventureFile) {
	return {
		locations: Object.keys(file.locations),
		chapters: Object.keys(file.chapters),
		events: Object.keys(file.events),
		clues: Object.keys(file.clues),
		npcs: Object.keys(file.npcs),
		objects: [...file.objects.map((o) => o.id), ...Object.keys(file.npcs)],
		decisions: Object.keys(file.decisions),
		encounters: Object.keys(file.encounters),
		enemies: Object.keys(file.enemies)
	};
}

export type Ids = ReturnType<typeof idsOf>;
