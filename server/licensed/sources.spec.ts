import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import '../rules';
import { describeTerms } from '../../src/lib/content/licence';
import { isLicensedId } from '../../src/lib/rules/dnd55e/homebrew';
import { dnd55e } from '../rules/dnd55e';
import { WITHHELD_TEXT } from '../rules/dnd55e/homebrew/pack';
import { homebrewRecord } from '../rules/dnd55e/homebrew/registry';
import { srdBestiary } from '../rules/dnd55e/monsters';
import { srdCatalog } from '../rules/dnd55e/catalog';
import {
	contentHash,
	forgetSources,
	installedSource,
	installSources,
	readSourceDir,
	readSourceFile
} from './sources';

export const EXAMPLE_DIR = path.resolve('content/licensed-example');
const example = () =>
	JSON.parse(readFileSync(path.join(EXAMPLE_DIR, 'clockwork-arsenal/source.json'), 'utf8'));

const temps: string[] = [];
afterAll(() => {
	for (const d of temps) rmSync(d, { recursive: true, force: true });
	forgetSources();
});
function copyExample(): string {
	const dir = mkdtempSync(path.join(os.tmpdir(), 'thirdfold-licensed-'));
	temps.push(dir);
	cpSync(EXAMPLE_DIR, dir, { recursive: true });
	return dir;
}

describe('licensed source files', () => {
	it('reads the hypothetical source in full, its terms in words', () => {
		const read = readSourceFile(example());
		expect(read.ok).toBe(true);
		if (!read.ok) return;
		expect(read.file).toMatchObject({
			id: 'clockwork-arsenal',
			publisher: 'Example Press',
			terms: { entitlement: 'granted', display: 'mechanics', withdrawal: 'finish' },
			provenance: { hypothetical: true }
		});
		expect(describeTerms(read.file.terms)).toContain('Mechanics only: its text is not shown');
	});

	it('refuses what it does not know, markup, newer formats and bad terms', () => {
		const problems = (patch: (f: Record<string, unknown>) => void) => {
			const f = example();
			patch(f);
			const r = readSourceFile(f);
			return r.ok ? [] : r.problems;
		};
		expect(problems((f) => (f.extra = 1))).toEqual(['extra: a field this server does not know']);
		expect(problems((f) => (f.formatVersion = 2))[0]).toMatch(/newer than this server reads/);
		expect(problems((f) => (f.about = '<script>x</script>'))).toEqual([
			'about: no markup, templates or code'
		]);
		expect(problems((f) => ((f.terms as { entitlement: string }).entitlement = 'anyone'))).toEqual([
			'terms.entitlement: one of open, granted'
		]);
		expect(
			problems((f) => ((f.terms as { licence: { url: string } }).licence.url = 'http://x'))
		).toEqual(['terms.licence.url: an https address, or null']);
	});

	it('pins its content by hash, whatever the line endings, and installs by folder', () => {
		const dir = copyExample();
		const one = path.join(dir, 'clockwork-arsenal');
		expect(readSourceDir(one).ok).toBe(true);
		const content = readFileSync(path.join(one, 'content.json'), 'utf8');
		writeFileSync(path.join(one, 'content.json'), content.replace(/\n/g, '\r\n'));
		expect(contentHash(readFileSync(path.join(one, 'content.json')))).toBe(contentHash(content));
		expect(readSourceDir(one).ok).toBe(true);
		writeFileSync(path.join(one, 'content.json'), content.replace('1d10', '2d10'));
		expect(readSourceDir(one)).toMatchObject({
			ok: false,
			problems: [expect.stringContaining('not the')]
		});
		expect(installSources(dir)).toMatchObject({ installed: [], skipped: [expect.any(String)] });
		expect(installSources(EXAMPLE_DIR)).toEqual({ installed: ['clockwork-arsenal'], skipped: [] });
	});
});

describe('licensed content under its rules', () => {
	installSources(EXAMPLE_DIR);
	const source = installedSource('clockwork-arsenal')!;

	it('is read like homebrew, but as its own kind: lc- ids, its terms and its credit', () => {
		const held = dnd55e.packs!.holdLicensed!({ file: source.file, content: source.content });
		expect(held.ok).toBe(true);
		if (!held.ok) return;
		expect(held.id).toMatch(/^lc-[0-9a-f]{16}$/);
		expect(isLicensedId(held.id)).toBe(true);
		const listing = dnd55e.packs!.listing(held.id, { owner: null, visibility: 'table' })!;
		expect(listing).toMatchObject({
			name: 'Clockwork Arsenal',
			creator: 'Example Press',
			source: 'licensed',
			licensed: { source: 'clockwork-arsenal', publisher: 'Example Press' }
		});
		expect(listing.records.map((r) => r.id.split(':')[0])).toEqual(Array(4).fill(held.id));
		// Its content is never written into a save.
		expect(dnd55e.packs!.content(held.id)).toBeNull();
		// The same content as homebrew is homebrew, with an id of its own.
		const asHomebrew = dnd55e.packs!.hold(source.content);
		expect(asHomebrew.ok && asHomebrew.id).toMatch(/^hb-/);
	});

	it('keeps back its words where the licence says mechanics only, and plays its mechanics', () => {
		const held = dnd55e.packs!.holdLicensed!({ file: source.file, content: source.content });
		if (!held.ok) throw new Error(held.problems.join('; '));
		const pike = homebrewRecord(`${held.id}:weapon:spring-pike`)!;
		expect(pike.text).not.toContain('wound spring');
		expect(pike.text).toContain('1d10 Piercing');
		const hound = srdBestiary(srdCatalog).enemy(`${held.id}-brass-hound`)!;
		expect(hound).toMatchObject({ name: 'Brass Hound' });
		expect(homebrewRecord(`${held.id}:monster:brass-hound`)!.text).toContain(WITHHELD_TEXT);
		// With display "full" the words come through.
		const full = dnd55e.packs!.holdLicensed!({
			file: { ...source.file, terms: { ...source.file.terms, display: 'full' } },
			content: source.content
		});
		if (!full.ok) throw new Error(full.problems.join('; '));
		expect(homebrewRecord(`${full.id}:weapon:spring-pike`)!.text).toContain('wound spring');
	});

	it('refuses content that carries its publisher’s marks', () => {
		const content = structuredClone(source.content) as { records: { name: string }[] };
		content.records[0].name = 'Clockwork Arsenal Pike';
		expect(dnd55e.packs!.holdLicensed!({ file: source.file, content })).toEqual({
			ok: false,
			problems: ['weapon spring-pike: names the publisher\'s mark "Clockwork Arsenal"']
		});
	});
});
