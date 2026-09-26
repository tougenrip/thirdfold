import { describe, expect, it } from 'vitest';
import { AmbienceLayer } from './ambience';

const grid = { kind: 'square' as const, width: 10, height: 8, cellSize: 1 };

describe('the mist', () => {
	it('drifts at dusk, and is not drawn at all while motion is reduced', () => {
		const mist = new AmbienceLayer();
		mist.update(grid, 'dusk');
		expect(mist.group.visible).toBe(true);
		mist.setReducedMotion(true);
		mist.update(grid, 'dusk');
		expect(mist.group.visible).toBe(false);
		expect(mist.tick(5000)).toBe(false);
		mist.setReducedMotion(false);
		mist.update(grid, 'dusk');
		expect(mist.group.visible).toBe(true);
		mist.dispose();
	});
});
