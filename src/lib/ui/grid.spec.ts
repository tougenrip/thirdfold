import { describe, expect, it } from 'vitest';
import { withGridSetting } from '$lib/tabletop/grid-modes';
import { gridModeOf, type GridMoment } from './grid';

const play: GridMoment = {
	isGm: false,
	building: false,
	tooling: false,
	placing: false,
	spawning: false,
	view: 'tabletop',
	selected: false
};

describe("the grid's mode", () => {
	it('is the full grid while the GM builds, never for a player by the panel or a tool', () => {
		expect(gridModeOf({ ...play, isGm: true, building: true })).toBe('build');
		expect(gridModeOf({ ...play, isGm: true, tooling: true })).toBe('build');
		expect(gridModeOf({ ...play, building: true, tooling: true })).toBe('explore');
	});

	it('is the full grid for anyone placing a token or an enemy', () => {
		for (const isGm of [false, true]) {
			expect(gridModeOf({ ...play, isGm, placing: true })).toBe('build');
			expect(gridModeOf({ ...play, isGm, spawning: true, view: 'tactical' })).toBe('build');
		}
	});

	it('is faint in the tactical view with nothing selected, else round the hover and selection', () => {
		expect(gridModeOf({ ...play, view: 'tactical' })).toBe('overview');
		expect(gridModeOf({ ...play, view: 'tactical', selected: true })).toBe('explore');
		expect(gridModeOf(play)).toBe('explore');
		expect(gridModeOf({ ...play, isGm: true, selected: true })).toBe('explore');
	});

	it('follows the Graphics menu: Auto keeps it, Always is the full grid, Off none', () => {
		for (const mode of ['build', 'explore', 'overview', 'off'] as const) {
			expect(withGridSetting(mode, 'auto')).toBe(mode);
			expect(withGridSetting(mode, 'always')).toBe('build');
			expect(withGridSetting(mode, 'off')).toBe('off');
		}
	});
});
