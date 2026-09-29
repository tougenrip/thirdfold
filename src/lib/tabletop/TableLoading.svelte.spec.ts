import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { Tabletop } from './types';
import TableLoading from './TableLoading.svelte';

/** A tabletop that only answers what the cover asks: its loads and whether it is at rest. */
function fake() {
	const state = { loads: [0, 2] as [number, number], holding: false, frames: 0, mode: 'active' };
	const tabletop = {
		loads: () => state.loads,
		stats: () => ({ holding: state.holding, frames: state.frames, mode: state.mode })
	} as unknown as Tabletop;
	return { state, tabletop };
}

describe('the table loading cover', () => {
	it('counts the loads, waits for the table to rest, then lifts', async () => {
		const { state, tabletop } = fake();
		const screen = render(TableLoading, { tabletop: null, table: '8x8 null' });
		await expect.element(page.getByRole('status')).toHaveTextContent('Setting the table');
		await screen.rerender({ tabletop, table: '8x8 null' });
		await expect.element(page.getByRole('status')).toHaveTextContent('Placing the pieces: 0 of 2');
		state.loads = [2, 2];
		state.holding = true;
		await expect.element(page.getByRole('status')).toHaveTextContent('Warming the lights');
		Object.assign(state, { holding: false, frames: 3, mode: 'idle' });
		await expect.element(page.getByRole('status'), { timeout: 3000 }).not.toBeInTheDocument();
		// A new table (travel): only its own loads count.
		state.loads = [2, 5];
		await screen.rerender({ tabletop, table: '30x20 stone-halls' });
		await expect.element(page.getByRole('status')).toHaveTextContent('Placing the pieces: 0 of 3');
	});
});
