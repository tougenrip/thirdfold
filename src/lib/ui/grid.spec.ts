import { describe, expect, it } from 'vitest';
import { gridShown, type GridMoment } from './grid';

const rest: GridMoment = {
	isGm: false,
	building: false,
	placing: false,
	spawning: false,
	aiming: false
};

describe('when the grid lines show', () => {
	it('hides them at rest, for the GM and players alike', () => {
		expect(gridShown(rest)).toBe(false);
		expect(gridShown({ ...rest, isGm: true })).toBe(false);
	});

	it('shows them to the GM with the Build panel open, and never for a player by it', () => {
		expect(gridShown({ ...rest, isGm: true, building: true })).toBe(true);
		expect(gridShown({ ...rest, building: true })).toBe(false);
	});

	it('shows them to anyone placing a token or an enemy, or aiming a move', () => {
		for (const isGm of [false, true]) {
			expect(gridShown({ ...rest, isGm, placing: true })).toBe(true);
			expect(gridShown({ ...rest, isGm, spawning: true })).toBe(true);
			expect(gridShown({ ...rest, isGm, aiming: true })).toBe(true);
		}
	});
});
