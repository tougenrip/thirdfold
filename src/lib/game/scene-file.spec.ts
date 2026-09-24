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
		{ id: 'hero-1', name: 'Hero', color: '#2e86c1', pos: { x: 2, y: 3 }, ownerId: 'p1', vision: 8 },
		{ id: 'orc-1', name: 'Orc', color: '#c0392b', pos: { x: 9, y: 9 }, ownerId: null, vision: 6 }
	];
	const objects: SceneObject[] = [
		{ id: 'w1', kind: 'wall', a: { x: 5, y: 0 }, b: { x: 5, y: 4 } },
		{ id: 'd1', kind: 'door', a: { x: 5, y: 4 }, b: { x: 5, y: 5 }, open: true }
	];
	return {
		grid: DEFAULT_GRID,
		tokens,
		objects,
		fog: { enabled: true, revealed },
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
