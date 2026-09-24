import { describe, expect, it } from 'vitest';
import { DEFAULT_GRID } from './grid';
import type { SceneObject } from './objects';
import { parseSceneFile, serializeScene, type SceneSource } from './scene-file';
import type { Token } from './token';
import { emptyMask } from './visibility';

function source(): SceneSource {
	const revealed = emptyMask(DEFAULT_GRID);
	revealed[0] = revealed[21] = 1;
	const tokens: Token[] = [
		{
			id: 'hero-1',
			name: 'Hero',
			color: '#2e86c1',
			pos: { x: 2, y: 3 },
			ownerId: 'p1',
			vision: 8,
			light: 3
		},
		{
			id: 'orc-1',
			name: 'Orc',
			color: '#c0392b',
			pos: { x: 9, y: 9 },
			ownerId: null,
			vision: 6,
			light: 0
		}
	];
	const objects: SceneObject[] = [
		{ id: 'w1', kind: 'wall', a: { x: 5, y: 0 }, b: { x: 5, y: 4 } },
		{ id: 'd1', kind: 'door', a: { x: 5, y: 4 }, b: { x: 5, y: 5 }, open: true }
	];
	return {
		grid: DEFAULT_GRID,
		tokens,
		objects,
		props: [{ id: 'crate-1', assetId: 'crate', pos: { x: 6, y: 6 }, rotation: 0, scale: 1 }],
		lights: [{ id: 'l1', pos: { x: 4, y: 4 }, radius: 5, color: '#ffa04d', on: true }],
		ambient: 'dark',
		fog: { enabled: true, revealed, shared: false },
		playerName: (id) => (id === 'p1' ? 'Pip' : undefined)
	};
}

const saved = () => JSON.parse(JSON.stringify(serializeScene('Crypt', source(), new Date(0))));

describe('serializeScene / parseSceneFile', () => {
	it('round-trips a scene through JSON', () => {
		const file = serializeScene('Crypt', source(), new Date('2026-01-02T03:04:05Z'));
		const parsed = parseSceneFile(JSON.parse(JSON.stringify(file)));
		expect(parsed).toEqual({ ok: true, scene: file });
	});

	it('keeps owners by id and name, and never saves session state', () => {
		const file = serializeScene('Crypt', source());
		expect(file.tokens[0].owner).toEqual({ id: 'p1', name: 'Pip' });
		expect(file.tokens[1].owner).toBeNull();
		const json = JSON.stringify(file);
		expect(json).not.toContain('explored');
		expect(json).not.toContain('sessionToken');
	});

	it('drops unknown fields rather than carrying them along', () => {
		const data = saved();
		data.tokens[0].script = 'alert(1)';
		data.__proto__polluted = true;
		const parsed = parseSceneFile(data);
		expect(parsed.ok && JSON.stringify(parsed.scene)).not.toContain('alert');
		expect(parsed.ok && JSON.stringify(parsed.scene)).not.toContain('polluted');
	});

	it('normalises names', () => {
		const data = saved();
		data.name = '  Crypt\u0000 ';
		data.tokens[0].name = ' Hero\n';
		const parsed = parseSceneFile(data);
		expect(parsed.ok && parsed.scene.name).toBe('Crypt');
		expect(parsed.ok && parsed.scene.tokens[0].name).toBe('Hero');
	});

	type Mutation = (d: ReturnType<typeof saved>) => void;
	it.each<[string, Mutation, RegExp]>([
		['not a scene', (d) => (d.format = 'other'), /not a thirdfold scene/],
		['a newer version', (d) => (d.version = 99), /newer version/],
		['a bogus version', (d) => (d.version = 'one'), /not a valid scene/],
		['a huge grid', (d) => (d.grid.width = 5000), /grid size/],
		['a hex grid', (d) => (d.grid.kind = 'hex'), /Unsupported grid/],
		['a token off the table', (d) => (d.tokens[0].pos = { x: 40, y: 0 }), /off the table/],
		['a fractional cell', (d) => (d.tokens[0].pos = { x: 1.5, y: 0 }), /off the table/],
		['stacked tokens', (d) => (d.tokens[1].pos = { ...d.tokens[0].pos }), /share the cell/],
		['a duplicate id', (d) => (d.tokens[1].id = d.tokens[0].id), /duplicate id/],
		['an id with path characters', (d) => (d.tokens[0].id = '../../etc'), /duplicate id/],
		['a bad colour', (d) => (d.tokens[0].color = 'javascript:alert(1)'), /colour/],
		['a bad vision', (d) => (d.tokens[0].vision = -1), /vision/],
		['a diagonal wall', (d) => (d.objects[0].b = { x: 7, y: 2 }), /grid lines/],
		['a long door', (d) => (d.objects[1].b = { x: 5, y: 7 }), /door is invalid/],
		['a wall through a door', (d) => (d.objects[0].b = { x: 5, y: 6 }), /through a door/],
		['an unknown object', (d) => (d.objects[0].kind = 'trap'), /Unknown/],
		['no fog block', (d) => delete d.fog, /fog/],
		['too many tokens', (d) => (d.tokens = Array(201).fill(d.tokens[0])), /at most 200/]
	])('rejects %s', (_label, mutate, error) => {
		const data = saved();
		mutate(data);
		const parsed = parseSceneFile(data);
		expect(parsed.ok).toBe(false);
		expect(!parsed.ok && parsed.error).toMatch(error);
	});

	it('rejects non-objects outright', () => {
		for (const input of [null, 'scene', 42, [saved()]])
			expect(parseSceneFile(input).ok).toBe(false);
	});
});

describe('scene file v2: lights', () => {
	it('saves lights, ambient and token light', () => {
		const file = serializeScene('Crypt', source());
		expect(file.version).toBe(6);
		expect(file.ambient).toBe('dark');
		expect(file.lights).toHaveLength(1);
		expect(file.tokens[0].light).toBe(3);
	});

	it('upgrades a v1 file: no lights, daylight, tokens carry no light', () => {
		const v1 = saved();
		v1.version = 1;
		delete v1.lights;
		delete v1.ambient;
		for (const t of v1.tokens) delete t.light;
		const parsed = parseSceneFile(v1);
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		expect(parsed.scene.version).toBe(6);
		expect(parsed.scene.props).toEqual([]);
		expect(parsed.scene.lights).toEqual([]);
		expect(parsed.scene.ambient).toBe('day');
		expect(parsed.scene.tokens.map((t) => t.light)).toEqual([0, 0]);
	});

	type Mutation = (d: ReturnType<typeof saved>) => void;
	it.each<[string, Mutation, RegExp]>([
		['a light off the table', (d) => (d.lights[0].pos = { x: 50, y: 0 }), /off the table/],
		['a huge light', (d) => (d.lights[0].radius = 500), /radius/],
		['a zero light', (d) => (d.lights[0].radius = 0), /radius/],
		['a bad light colour', (d) => (d.lights[0].color = 'orange'), /colour/],
		['a light id clashing with a token', (d) => (d.lights[0].id = d.tokens[0].id), /duplicate id/],
		['an unknown ambient', (d) => (d.ambient = 'eclipse'), /ambient/],
		['a bad token light', (d) => (d.tokens[0].light = -2), /light radius/]
	])('rejects %s', (_label, mutate, error) => {
		const data = saved();
		mutate(data);
		const parsed = parseSceneFile(data);
		expect(!parsed.ok && parsed.error).toMatch(error);
	});
});

describe('scene file v3: props', () => {
	it('keeps props through a round trip', () => {
		const file = serializeScene('Crypt', source());
		const parsed = parseSceneFile(JSON.parse(JSON.stringify(file)));
		expect(parsed.ok && parsed.scene.props).toEqual([
			{ id: 'crate-1', assetId: 'crate', pos: { x: 6, y: 6 }, rotation: 0, scale: 1 }
		]);
	});

	type Mutation = (d: ReturnType<typeof saved>) => void;
	it.each<[string, Mutation, RegExp]>([
		['an unknown asset', (d) => (d.props[0].assetId = 'dragon'), /unknown asset/],
		['a prototype key as asset', (d) => (d.props[0].assetId = '__proto__'), /unknown asset/],
		['a bad rotation', (d) => (d.props[0].rotation = 5), /rotation/],
		['a giant prop', (d) => (d.props[0].scale = 40), /scale/],
		['a prop off the table', (d) => (d.props[0].pos = { x: 20, y: 0 }), /off the table/],
		['a prop on a token', (d) => (d.props[0].pos = { ...d.tokens[0].pos }), /overlaps/]
	])('rejects %s', (_label, mutate, error) => {
		const data = saved();
		mutate(data);
		const parsed = parseSceneFile(data);
		expect(!parsed.ok && parsed.error).toMatch(error);
	});
});

describe('scene file v4: the story played at the table', () => {
	const story = { id: 'hollow-bell', version: 1, state: { chapter: 'village', events: ['a'] } };

	it('saves no story for a free table, and upgrades a v3 file to none', () => {
		expect(serializeScene('Crypt', source()).adventure).toBeNull();
		const v3 = saved();
		v3.version = 3;
		delete v3.adventure;
		const parsed = parseSceneFile(v3);
		expect(parsed.ok && parsed.scene).toMatchObject({ version: 6, adventure: null });
	});

	it('keeps a story through a round trip, as a copy', () => {
		const file = serializeScene('Crypt', { ...source(), adventure: story });
		expect(file.adventure).toEqual(story);
		expect(file.adventure).not.toBe(story);
		const parsed = parseSceneFile(JSON.parse(JSON.stringify(file)));
		expect(parsed.ok && parsed.scene.adventure).toEqual(story);
	});

	const deep = (n: number): unknown => (n === 0 ? 1 : { next: deep(n - 1) });
	type Mutation = (d: ReturnType<typeof saved>) => void;
	it.each<[string, Mutation]>([
		['a story that is not an object', (d) => (d.adventure = 'hollow-bell')],
		['a story with a bad id', (d) => (d.adventure = { ...story, id: '../etc' })],
		['a story with no version', (d) => (d.adventure = { ...story, version: 'one' })],
		['a story with no state', (d) => (d.adventure = { ...story, state: [] })],
		['a story nested too deep', (d) => (d.adventure = { ...story, state: deep(40) })],
		['a story with a non-finite number', (d) => (d.adventure = { ...story, state: { n: NaN } })]
	])('rejects %s', (_label, mutate) => {
		const data = saved();
		mutate(data);
		const parsed = parseSceneFile(data);
		expect(!parsed.ok && parsed.error).toMatch(/saved story/);
	});
});

describe('scene file v5: elevation and windows', () => {
	it('saves a flat table with no level map, and upgrades a v4 file to flat', () => {
		expect(serializeScene('Crypt', source()).terrain).toBeNull();
		const v4 = saved();
		v4.version = 4;
		delete v4.terrain;
		const parsed = parseSceneFile(v4);
		expect(parsed.ok && parsed.scene).toMatchObject({ version: 6, terrain: null });
	});

	it('keeps levels and windows through a round trip', () => {
		const levels = new Uint8Array(DEFAULT_GRID.width * DEFAULT_GRID.height);
		levels[5] = 3;
		const src = source();
		const objects: SceneObject[] = [
			...src.objects,
			{ id: 'win', kind: 'wall', a: { x: 0, y: 7 }, b: { x: 3, y: 7 }, window: true }
		];
		const file = serializeScene('Tower', { ...src, objects, terrain: levels });
		const parsed = parseSceneFile(JSON.parse(JSON.stringify(file)));
		if (!parsed.ok) throw new Error(parsed.error);
		expect(parsed.scene.terrain).toBe(file.terrain);
		expect(parsed.scene.objects.find((o) => o.id === 'win')).toMatchObject({ window: true });
	});

	type Mutation = (d: ReturnType<typeof saved>) => void;
	it.each<[string, Mutation, RegExp]>([
		['a level map of the wrong size', (d) => (d.terrain = btoa('abc')), /elevation/],
		['a level map that is not a string', (d) => (d.terrain = [1, 2, 3]), /elevation/],
		['a window that is not a flag', (d) => (d.objects[0].window = 'yes'), /window/]
	])('rejects %s', (_label, mutate, error) => {
		const data = saved();
		mutate(data);
		const parsed = parseSceneFile(data);
		expect(!parsed.ok && parsed.error).toMatch(error);
	});

	it('drops a level map that is all floor', () => {
		const data = saved();
		data.terrain = btoa('\0'.repeat(DEFAULT_GRID.width * DEFAULT_GRID.height));
		const parsed = parseSceneFile(data);
		expect(parsed.ok && parsed.scene.terrain).toBeNull();
	});
});
