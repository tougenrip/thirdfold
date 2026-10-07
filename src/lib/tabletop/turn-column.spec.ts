import { describe, expect, it, vi } from 'vitest';
import type { Token } from '$lib/game/token';
import { OverlayLayer } from './overlay';
import { TokenLayer } from './tokens';
import { COLUMN_HEIGHT } from './turn-column';

const grid = { kind: 'square', width: 6, height: 6, cellSize: 1 } as const;
const token = (id: string, x: number): Token =>
	({ id, name: id, pos: { x, y: 2 }, color: '#888888', ownerId: null }) as Token;

// The label layer's atlas wants a canvas: in Node a stand-in that draws nothing.
const ctx: object = new Proxy({}, { get: () => () => ctx });
vi.stubGlobal('document', { createElement: () => ({ getContext: () => ctx }) });

describe('the turn column (#269)', () => {
	it('stands on the active mini, banded for an enemy, and goes with nobody or the token', () => {
		const overlay = new OverlayLayer();
		const layer = new TokenLayer(overlay);
		const { column } = layer;
		const mesh = column.mesh;
		expect(mesh.parent).toBe(overlay.scene); // drawn in the overlay pass
		layer.sync([token('a', 1), token('b', 4)], grid);
		expect(mesh.visible).toBe(false);

		expect(layer.setActive('a')).toBe(true);
		expect(mesh.visible).toBe(true);
		expect(column.enemyTurn).toBe(false);
		const a = layer.rootOf('a')!.position;
		expect(mesh.position.x).toBeCloseTo(a.x);
		expect(mesh.position.y).toBeCloseTo(a.y + COLUMN_HEIGHT / 2);
		expect(mesh.scale.y).toBeCloseTo(COLUMN_HEIGHT);

		expect(layer.setActive('a', true)).toBe(true); // the same token, now an enemy's turn
		expect(column.enemyTurn).toBe(true);
		expect(layer.setActive('a', true)).toBe(false);

		expect(layer.setActive(null)).toBe(true);
		expect(mesh.visible).toBe(false);

		// A turn for a token the viewer wasn't sent shows nothing; removing the active token hides it.
		layer.setActive('unseen', true);
		expect(mesh.visible).toBe(false);
		layer.setActive('b', true);
		expect(mesh.visible).toBe(true);
		layer.sync([token('a', 1)], grid);
		expect(mesh.visible).toBe(false);

		// The same material throughout: no program changes with the turn.
		expect(layer.gallery()[0]).toMatchObject({ material: mesh.material });
		layer.dispose();
		expect(mesh.parent).toBeNull();
	});
});
