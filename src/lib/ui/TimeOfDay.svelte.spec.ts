import { page, userEvent } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { DEFAULT_WORLD, type WorldLook } from '$lib/game/world';
import type { RoomAction } from '$lib/net/room-connection.svelte';
import TimeOfDay from './TimeOfDay.svelte';

function mount(world: Partial<WorldLook> = {}, ambient: 'day' | 'dusk' | 'dark' = 'day') {
	const sent: RoomAction[] = [];
	render(TimeOfDay, {
		world: { ...DEFAULT_WORLD, ...world },
		ambient,
		send: (action) => (sent.push(action), true)
	});
	return sent;
}

const slider = () => page.getByRole('slider', { name: 'Time of day' });

describe('the time of day', () => {
	it('sends one world_set when a drag is released, not while dragging', async () => {
		const sent = mount();
		const input = slider().element() as HTMLInputElement;
		for (const value of ['800', '1000', '1260']) {
			input.value = value;
			input.dispatchEvent(new Event('input', { bubbles: true }));
		}
		await expect.element(slider()).toHaveAttribute('aria-valuetext', '21:00, night');
		expect(sent).toEqual([]);
		input.dispatchEvent(new Event('change', { bubbles: true }));
		expect(sent).toEqual([{ type: 'world_set', patch: { time: 1260 } }]);
	});

	it('sends one world_set per arrow key step, and PageUp moves an hour', async () => {
		const sent = mount();
		(slider().element() as HTMLInputElement).focus();
		await userEvent.keyboard('{ArrowRight}');
		expect(sent).toEqual([{ type: 'world_set', patch: { time: 725 } }]);
		await userEvent.keyboard('{PageUp}');
		expect(sent.at(-1)).toEqual({ type: 'world_set', patch: { time: 785 } });
		await userEvent.keyboard('{PageDown}');
		expect(sent.at(-1)).toEqual({ type: 'world_set', patch: { time: 725 } });
	});

	it('offers quick picks as a radio group that send their hours', async () => {
		const sent = mount({ time: 1170 }, 'dusk');
		const group = page.getByRole('radiogroup', { name: 'Quick times' });
		await expect.element(group).toBeInTheDocument();
		await expect
			.element(page.getByRole('radio', { name: 'Dusk' }))
			.toHaveAttribute('aria-checked', 'true');
		await expect
			.element(page.getByRole('radio', { name: 'Noon' }))
			.toHaveAttribute('aria-checked', 'false');
		await expect.element(page.getByText('Dusk:')).toBeInTheDocument();
		await userEvent.click(page.getByRole('radio', { name: 'Night' }));
		expect(sent).toEqual([{ type: 'world_set', patch: { time: 1380 } }]);
		await expect.element(page.getByText('Night:')).toBeInTheDocument();
	});

	it('shows band radios underground, and the atmosphere disabled', async () => {
		const sent = mount({ sun: false }, 'dark');
		await expect.element(slider()).not.toBeInTheDocument();
		await expect.element(page.getByText(/Underground: the hour/)).toBeInTheDocument();
		await expect
			.element(page.getByRole('radio', { name: 'Night' }))
			.toHaveAttribute('aria-checked', 'true');
		await userEvent.click(page.getByRole('radio', { name: 'Dusk' }));
		expect(sent).toEqual([{ type: 'ambient_set', ambient: 'dusk' }]);
		await userEvent.click(page.getByRole('checkbox', { name: /Underground/ }));
		expect(sent.at(-1)).toEqual({ type: 'world_set', patch: { sun: true } });
		await userEvent.click(page.getByText('Atmosphere'));
		await expect.element(page.getByRole('combobox', { name: 'Weather' })).toBeDisabled();
	});
});
