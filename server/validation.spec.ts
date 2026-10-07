// One validator for all content (milestone 56): each kind checked the way it
// will be used, every finding a diagnostic with a stable code and a path.

import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { exampleAdventure } from '../src/lib/adventure/example';
import { blankScene, SCENE_FILE_VERSION } from '../src/lib/game/scene-file';
import type { Validation } from '../src/lib/validation/diagnostics';
import { startAdventure } from './adventure/engine';
import type { Shelves } from './collections';
import { MemoryLibraryStore } from './library-store';
import { RoomManager } from './rooms';
import { examplePack } from './rules/dnd55e/homebrew/example';
import { exportScene } from './scene-io';
import { MemorySceneStore } from './scene-store';
import { validateContent } from './validation';

const hex64 = () => randomBytes(32).toString('hex');
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const codes = (v: Validation) => v.diagnostics.map((d) => d.code);

function context() {
	const shelves: Shelves = { library: new MemoryLibraryStore(), scenes: new MemorySceneStore() };
	return { shelves, owner: hex64() };
}

const srd = (kind: string, slug: string) => `srd-5.2.1:${kind}:${slug}`;
const rogue = () => ({
	name: 'Wren',
	color: '#17A589',
	species: {
		id: srd('species', 'human'),
		options: { size: 'small', skillful: 'perception' },
		feat: { feat: srd('feat', 'skilled'), skills: ['history', 'medicine', 'survival'] }
	},
	background: { id: srd('background', 'criminal'), increases: { dex: 2, int: 1 } },
	class: {
		id: srd('class', 'rogue'),
		skills: ['acrobatics', 'insight', 'investigation', 'persuasion'],
		expertise: ['stealth', 'investigation'],
		fightingStyle: null,
		weaponMasteries: [srd('weapon', 'rapier'), srd('weapon', 'shortbow')]
	},
	abilities: { method: 'point-buy', base: { str: 8, dex: 15, con: 14, int: 13, wis: 12, cha: 10 } },
	armor: { worn: srd('armor', 'leather-armor'), shield: false },
	weapons: [srd('weapon', 'rapier'), srd('weapon', 'shortbow')]
});

function savedTable(adventureId: string) {
	const { room, player } = new RoomManager().create('Gia') as Extract<
		ReturnType<RoomManager['create']>,
		{ ok: true }
	>;
	const started = startAdventure(room, player, adventureId);
	if (!started.ok) throw new Error(started.message);
	return copy(exportScene(room, 'Saved'));
}

describe('validating an adventure file', () => {
	it('passes the example and names what is wrong in a broken one', async () => {
		const ctx = context();
		const ok = await validateContent('adventure', exampleAdventure(), ctx);
		expect(ok).toMatchObject({
			kind: 'adventure',
			ok: true,
			diagnostics: [],
			validator: { id: 'thirdfold-adventure', version: 1, format: 1 }
		});
		const f = copy(exampleAdventure()) as unknown as Record<string, Record<string, unknown>>;
		(f.chapters.the_mill as Record<string, unknown>).mood = 'grim';
		const bad = await validateContent('adventure', f, ctx);
		expect(bad.ok).toBe(false);
		expect(bad.diagnostics).toEqual([
			expect.objectContaining({ code: 'schema.unknown_field', path: 'chapters.the_mill.mood' })
		]);
	});
});

describe('validating homebrew', () => {
	it('passes the example pack', async () => {
		const v = await validateContent('pack', examplePack(), context());
		expect(v).toMatchObject({ ok: true, diagnostics: [], validator: { format: 1 } });
	});

	it('refuses unknown fields, markup, the SRD’s names, other rules and newer formats', async () => {
		const ctx = context();
		const unknown = examplePack() as { records: Record<string, unknown>[] };
		unknown.records[0].glow = true;
		expect(codes(await validateContent('pack', unknown, ctx))).toContain('schema.unknown_field');
		const markup = examplePack() as { records: Record<string, unknown>[] };
		markup.records[0].text = 'A blade. <script>alert(1)</script>';
		expect(codes(await validateContent('pack', markup, ctx))).toContain('content.markup');
		const named = examplePack() as { records: Record<string, unknown>[] };
		named.records[0].name = 'Longsword';
		expect(codes(await validateContent('pack', named, ctx))).toContain('content.srd_name');
		expect(
			await validateContent('pack', { ...examplePack(), rules: { id: 'gurps', version: 4 } }, ctx)
		).toMatchObject({ ok: false, diagnostics: [{ code: 'rules.unknown', path: 'rules' }] });
		expect(
			await validateContent('pack', { ...examplePack(), formatVersion: 7 }, ctx)
		).toMatchObject({
			ok: false,
			validator: { format: 7 },
			diagnostics: [{ code: 'format.newer', path: 'formatVersion' }]
		});
	});
});

describe('validating a collection', () => {
	const collection = (over: Record<string, unknown> = {}) => ({
		format: 'thirdfold-collection',
		formatVersion: 1,
		title: 'Cold Hill Campaign',
		about: 'The barrow, and beyond.',
		adventures: [{ builtIn: 'barrow' }],
		packs: [],
		tables: [],
		...over
	});

	it('passes one whose pieces are all there, and points at each one that isn’t', async () => {
		const ctx = context();
		expect(await validateContent('collection', collection(), ctx)).toMatchObject({
			ok: true,
			diagnostics: []
		});
		const table = await ctx.shelves.scenes.save(blankScene('Crossroads', 8, 8, null));
		const v = await validateContent(
			'collection',
			collection({
				adventures: [{ builtIn: 'barrow' }, { builtIn: 'hollow-bell' }],
				packs: [{ library: 'f'.repeat(32), version: 1 }],
				tables: [{ code: table, name: 'Crossroads' }]
			}),
			ctx
		);
		expect(v.ok).toBe(false);
		expect(v.diagnostics).toEqual([
			expect.objectContaining({ code: 'dependency.incompatible', path: 'adventures[1]' }),
			expect.objectContaining({ code: 'dependency.missing', path: 'packs[0]' })
		]);
	});

	it('refuses fields a collection doesn’t have, and newer formats', async () => {
		const ctx = context();
		expect(
			codes(await validateContent('collection', collection({ script: 'run()' }), ctx))
		).toContain('schema.unknown_field');
		expect(
			codes(await validateContent('collection', collection({ formatVersion: 2 }), ctx))
		).toEqual(['format.newer']);
	});
});

describe('validating a character', () => {
	const rules = { id: 'dnd-5.5e', version: 1 };

	it('passes a legal level 1 character and names each choice the rules refuse', async () => {
		const ctx = context();
		expect(await validateContent('character', { rules, choices: rogue() }, ctx)).toMatchObject({
			ok: true,
			diagnostics: []
		});
		const bad = rogue();
		bad.class.expertise = ['athletics', 'stealth'];
		const v = await validateContent('character', { rules, choices: bad }, ctx);
		expect(v.ok).toBe(false);
		expect(codes(v).every((c) => c === 'character.invalid')).toBe(true);
		expect(
			await validateContent(
				'character',
				{ rules: { id: 'thirdfold-classic', version: 1 }, choices: rogue() },
				ctx
			)
		).toMatchObject({ ok: false, diagnostics: [{ code: 'rules.unknown' }] });
	});
});

describe('validating a saved table', () => {
	it('reads a save with its story as a load would', async () => {
		const ctx = context();
		const v = await validateContent('save', savedTable('barrow'), ctx);
		expect(v).toMatchObject({ ok: true, validator: { format: SCENE_FILE_VERSION } });
		expect(v.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
	});

	it('refuses a newer table, a damaged one, and a story that no longer reads', async () => {
		const ctx = context();
		const newer = await validateContent('save', { ...savedTable('hollow-bell'), version: 99 }, ctx);
		expect(newer).toMatchObject({ ok: false, diagnostics: [{ code: 'format.newer' }] });
		const damaged = savedTable('hollow-bell') as unknown as Record<string, unknown>;
		damaged.grid = 'square';
		expect(codes(await validateContent('save', damaged, ctx))).toEqual(['save.invalid']);
		const story = savedTable('hollow-bell') as unknown as {
			adventure: { state: Record<string, unknown> };
		};
		story.adventure.state.chapter = 'nowhere';
		const v = await validateContent('save', story, ctx);
		expect(v).toMatchObject({
			ok: false,
			diagnostics: [{ code: 'save.invalid', path: 'adventure' }]
		});
	});

	it('says when it rests on content made from another source', async () => {
		const ctx = context();
		const saved = savedTable('barrow') as unknown as {
			adventure: { state: { lock: { content: { sha256: string }[] } } };
		};
		saved.adventure.state.lock.content[0].sha256 = '0'.repeat(64);
		const v = await validateContent('save', saved, ctx);
		expect(v).toMatchObject({ ok: false, diagnostics: [{ code: 'version.source' }] });
	});
});
