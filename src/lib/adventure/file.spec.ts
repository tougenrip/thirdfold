import { describe, expect, it } from 'vitest';
import { exampleAdventure } from './example';
import { compileAdventure, loadAdventureFile, parseAdventureFile } from './file';

const json = <T>(v: T): T => JSON.parse(JSON.stringify(v));

describe('adventure files', () => {
	it('loads the example: parsed, compiled and with nothing wrong', () => {
		const loaded = loadAdventureFile(json(exampleAdventure()), 'custom-test');
		if (!loaded.ok) throw new Error(`${loaded.error}\n${loaded.problems?.join('\n')}`);
		const A = loaded.adventure;
		expect(A).toMatchObject({ id: 'custom-test', title: 'The Miller’s Key' });
		expect(Object.keys(A.characters)).toEqual(['warden', 'veil', 'ember', 'saint']);
		expect(A.chapters.the_cellar).toMatchObject({ id: 'the_cellar', location: 'cellar' });
		expect(A.enemies.rat.hp(1)).toBe(4);
		expect(A.enemies.rat.hp(4)).toBe(7);
		// People stand on their table, and can be talked to.
		expect(A.locations.yard.scene().tokens).toEqual([
			expect.objectContaining({ id: 'npc-miller', name: 'The miller', model: 'villager' })
		]);
		expect(A.objects.find((o) => o.id === 'miller')).toMatchObject({
			thing: { token: 'npc-miller' },
			verbs: [{ id: 'talk' }]
		});
		// Each call is a fresh table.
		expect(A.locations.yard.scene()).not.toBe(A.locations.yard.scene());
	});

	it('round-trips through JSON unchanged', () => {
		const parsed = parseAdventureFile(json(exampleAdventure()));
		if (!parsed.ok) throw new Error(parsed.error);
		const again = parseAdventureFile(json(parsed.file));
		expect(again).toEqual({ ok: true, file: parsed.file });
	});

	it('refuses what is not an adventure, naming where', () => {
		const file = json(exampleAdventure()) as unknown as Record<string, unknown>;
		expect(parseAdventureFile({ ...file, format: 'thirdfold-scene' })).toMatchObject({ ok: false });
		expect(parseAdventureFile({ ...file, version: 2 })).toMatchObject({ ok: false });
		expect(parseAdventureFile({ ...file, characters: ['wizard'] })).toMatchObject({
			ok: false,
			error: expect.stringContaining('characters[0]')
		});
		const badEffect = json(exampleAdventure());
		(badEffect.start.arrival as unknown[]).push({ say: 'x', event: 'y' });
		expect(parseAdventureFile(badEffect)).toMatchObject({
			ok: false,
			error: expect.stringContaining('start.arrival[1]')
		});
		const badId = json(exampleAdventure());
		(badId.chapters as Record<string, unknown>)['__proto__x'] = badId.chapters.the_mill;
		expect(parseAdventureFile(badId)).toMatchObject({ ok: false });
		const badScene = json(exampleAdventure());
		(badScene.locations.yard.scene as unknown as Record<string, unknown>).grid = 'big';
		expect(parseAdventureFile(badScene)).toMatchObject({
			ok: false,
			error: expect.stringContaining('locations.yard.scene')
		});
		const badDice = json(exampleAdventure());
		badDice.enemies.rat.attacks[0].damage = 'eval(1)';
		expect(parseAdventureFile(badDice)).toMatchObject({ ok: false });
	});

	it('drops what it does not know', () => {
		const file = json(exampleAdventure()) as unknown as Record<string, unknown>;
		const parsed = parseAdventureFile({ ...file, script: 'alert(1)' });
		expect(parsed.ok && 'script' in parsed.file).toBe(false);
	});

	it('names references that go nowhere, and what an adventure lacks', () => {
		const broken = json(exampleAdventure());
		broken.chapters.the_mill.next.to = 'nowhere';
		broken.objects[0].thing = { prop: 'not-there' };
		broken.characters = [];
		const loaded = loadAdventureFile(broken, 'custom-x');
		expect(loaded.ok).toBe(false);
		if (loaded.ok) return;
		expect(loaded.problems).toEqual(
			expect.arrayContaining([
				'chapter the_mill: no chapter "nowhere"',
				'characters: pick at least one',
				'object sack: not on the yard table'
			])
		);
	});

	it('compiles a file without people or fights', () => {
		const file = json(exampleAdventure());
		const bare = { ...file, npcs: {}, reactions: [], encounters: {}, enemies: {} };
		const A = compileAdventure(parseOk(bare), 'custom-bare');
		expect(A.objects.map((o) => o.id)).toEqual(['sack']);
		expect(A.encounters).toEqual({});
	});
});

function parseOk(raw: unknown) {
	const parsed = parseAdventureFile(raw);
	if (!parsed.ok) throw new Error(parsed.error);
	return parsed.file;
}
