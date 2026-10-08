import { describe, expect, it } from 'vitest';
import { exampleAdventure } from './example';
import { compileAdventure, loadAdventureFile, parseAdventureFile } from './file';
import { SCENE_FILE_VERSION } from '../game/scene-file';
import { defaultWorldFor } from '../game/world';

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
		// Looks come with the tables: evening in the yard, no sun in the cellar (still the day band).
		expect(A.locations.yard.scene()).toMatchObject({ ambient: 'dusk', world: { time: 1170 } });
		expect(A.locations.cellar.scene()).toMatchObject({ ambient: 'day', world: { sun: false } });
		// Each call is a fresh table.
		expect(A.locations.yard.scene()).not.toBe(A.locations.yard.scene());
	});

	it('loads a file published before the world look, whose tables are v9 scenes', () => {
		const file = json(exampleAdventure());
		for (const loc of Object.values(file.locations)) {
			const scene = loc.scene as unknown as Record<string, unknown>;
			scene.version = 9;
			delete scene.world;
			delete scene.interior;
		}
		const loaded = loadAdventureFile(file, 'custom-old');
		if (!loaded.ok) throw new Error(`${loaded.error}\n${loaded.problems?.join('\n')}`);
		const yard = loaded.adventure.locations.yard.scene();
		expect(yard.version).toBe(SCENE_FILE_VERSION);
		expect(yard.world).toEqual(defaultWorldFor(yard.ambient));
	});

	it('round-trips through JSON unchanged', () => {
		const parsed = parseAdventureFile(json(exampleAdventure()));
		if (!parsed.ok) throw new Error(parsed.error);
		const again = parseAdventureFile(json(parsed.file));
		expect(again).toEqual({ ok: true, file: parsed.file });
	});

	it("takes a shot's frame 'overview' or 'table', and stores 'table' for older bundles", () => {
		const withFrame = (frame: string) => {
			const file = json(exampleAdventure()) as unknown as {
				start: { arrival: Record<string, unknown>[] };
			};
			file.start.arrival[0].shot = { focus: null, frame };
			const parsed = parseAdventureFile(file);
			if (!parsed.ok) throw new Error(parsed.error);
			return parsed.file.start.arrival[0];
		};
		expect(withFrame('table')).toMatchObject({ shot: { focus: null, frame: 'table' } });
		expect(withFrame('overview')).toMatchObject({ shot: { focus: null, frame: 'table' } });
		expect(() => withFrame('tabletop')).toThrow();
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

	it("parses an enemy's carried light colour, lowercased, and refuses a bad one (#202)", () => {
		const lit = json(exampleAdventure());
		(lit.enemies.rat as { lightColor?: string }).lightColor = '#B8C8FF';
		const loaded = loadAdventureFile(lit, 'custom-lit');
		if (!loaded.ok) throw new Error(loaded.error);
		expect(loaded.adventure.enemies.rat.lightColor).toBe('#b8c8ff');
		(lit.enemies.rat as { lightColor?: string }).lightColor = 'blue';
		expect(parseAdventureFile(lit)).toMatchObject({
			ok: false,
			error: expect.stringContaining('enemies.rat.lightColor')
		});
	});

	it("parses an enemy's size on the table and refuses one out of range (#270)", () => {
		const big = json(exampleAdventure());
		const rat = big.enemies.rat as { scale?: unknown };
		rat.scale = 1.8;
		const loaded = loadAdventureFile(big, 'custom-big');
		if (!loaded.ok) throw new Error(loaded.error);
		expect(loaded.adventure.enemies.rat.scale).toBe(1.8);
		for (const scale of [0.2, 3.5, '2', Number.NaN]) {
			rat.scale = scale;
			expect(parseAdventureFile(big)).toMatchObject({
				ok: false,
				error: expect.stringContaining('enemies.rat.scale')
			});
		}
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
				'characters: pick at least one, or let players build their own',
				'object sack: not on the yard table'
			])
		);
	});

	it('parses world effects and light looks, and still the time of day (#205)', () => {
		const file = json(exampleAdventure());
		file.locations.yard.scene.lights.push({
			id: 'lamp',
			pos: { x: 2, y: 2 },
			radius: 3,
			color: '#ffa04d',
			on: true
		});
		const arrival = file.start.arrival as unknown[];
		arrival.push(
			{ world: { time: 1290, weather: { kind: 'rain', intensity: 0.5 }, grade: { exposure: -1 } } },
			{ light: 'lamp', on: false, kind: 'lantern', flicker: 'candle', fixture: false },
			{ prop: 'sack', asset: 'barrel' },
			{ ambient: 'dusk' }
		);
		const loaded = loadAdventureFile(file, 'custom-world');
		if (!loaded.ok) throw new Error(`${loaded.error}\n${loaded.problems?.join('\n')}`);
		expect(loaded.adventure.start.arrival.slice(-4)).toEqual(arrival.slice(-4));
		expect(parseOk(json(parseOk(file)))).toEqual(parseOk(file));
	});

	it('names the path of a bad world patch or light look', () => {
		const withEffect = (effect: unknown) => {
			const file = json(exampleAdventure());
			(file.start.arrival as unknown[]).push(effect);
			return parseAdventureFile(file);
		};
		const at = (path: string) => ({ ok: false, error: expect.stringContaining(path) });
		expect(withEffect({ world: { weather: { kind: 'hail' } } })).toMatchObject(
			at('start.arrival[1].world.weather')
		);
		expect(withEffect({ world: { weather: { since: 5 } } })).toMatchObject(
			at('start.arrival[1].world.weather')
		);
		expect(withEffect({ world: { time: 'noon' } })).toMatchObject(
			at('start.arrival[1].world.time')
		);
		expect(withEffect({ world: {} })).toMatchObject(at('start.arrival[1].world'));
		expect(withEffect({ world: 'dusk' })).toMatchObject(at('start.arrival[1].world'));
		expect(withEffect({ light: 'lamp', kind: 'laser' })).toMatchObject(at('start.arrival[1].kind'));
		expect(withEffect({ light: 'lamp', facing: 5 })).toMatchObject(at('start.arrival[1].facing'));
	});

	it('names light and prop effects whose ids no table has', () => {
		const file = json(exampleAdventure());
		(file.start.arrival as unknown[]).push(
			{ light: 'nope', on: true },
			{ prop: 'gone', asset: 'barrel' }
		);
		const loaded = loadAdventureFile(file, 'custom-ids');
		expect(loaded.ok).toBe(false);
		if (loaded.ok) return;
		expect(loaded.problems).toEqual(
			expect.arrayContaining(['arrival: no light "nope"', 'arrival: no prop "gone"'])
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
