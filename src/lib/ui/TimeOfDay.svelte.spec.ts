import { page, userEvent } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { DEFAULT_WORLD, type WorldLook } from '$lib/game/world';
import type { RoomAction } from '$lib/net/room-connection.svelte';
import TimeOfDay from './TimeOfDay.svelte';

// A stub manifest: two skies, and an environment under the enclosed one.
vi.mock('$lib/assets/load', () => ({
	loadManifest: async () => ({
		skies: {
			temperate: { kind: 'open', name: 'Temperate' },
			underground: { kind: 'enclosed', name: 'Underground' }
		},
		environments: { cave: { sky: 'underground' } }
	})
}));

function mount(
	world: Partial<WorldLook> = {},
	ambient: 'day' | 'dusk' | 'dark' = 'day',
	environment: string | null = null
) {
	const sent: RoomAction[] = [];
	render(TimeOfDay, {
		world: { ...DEFAULT_WORLD, ...world },
		ambient,
		environment,
		send: (action) => (sent.push(action), true)
	});
	return sent;
}

const fire = (input: HTMLInputElement, value: string, type: 'input' | 'change') => {
	input.value = value;
	input.dispatchEvent(new Event(type, { bubbles: true }));
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

	it('shows band radios underground, and the weather disabled', async () => {
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

describe('the atmosphere', () => {
	const open = () => userEvent.click(page.getByText('Atmosphere'));

	it('lists the manifest skies and sends the chosen one, or null for the place', async () => {
		const sent = mount({ sky: 'underground' });
		await open();
		const select = page.getByRole('combobox', { name: 'Sky' });
		await expect.element(page.getByRole('option', { name: 'Temperate' })).toBeInTheDocument();
		await userEvent.selectOptions(select, 'Temperate');
		expect(sent).toEqual([{ type: 'world_set', patch: { sky: 'temperate' } }]);
		await userEvent.selectOptions(select, "The place's own");
		expect(sent.at(-1)).toEqual({ type: 'world_set', patch: { sky: null } });
	});

	it('says an enclosed sky shows no time of day', async () => {
		mount({}, 'day', 'cave');
		await expect.element(page.getByText(/No sky here/)).toBeInTheDocument();
	});

	it('sends each slider once on release, and nothing for an unchanged value', async () => {
		const sent = mount();
		await open();
		const haze = page.getByRole('slider', { name: 'Haze' }).element() as HTMLInputElement;
		const exposure = page.getByRole('slider', { name: 'Exposure' }).element() as HTMLInputElement;
		const colour = page.getByLabelText('Haze colour').element() as HTMLInputElement;
		fire(haze, '0', 'change');
		expect(sent).toEqual([]);
		fire(haze, '0.4', 'input');
		fire(haze, '0.4', 'change');
		fire(exposure, '0.5', 'input');
		fire(exposure, '0.5', 'change');
		fire(colour, '#336699', 'change');
		expect(sent).toEqual([
			{ type: 'world_set', patch: { haze: { density: 0.4 } } },
			{ type: 'world_set', patch: { grade: { exposure: 0.5 } } },
			{ type: 'world_set', patch: { haze: { color: '#336699' } } }
		]);
		await expect
			.element(page.getByRole('slider', { name: 'Haze' }))
			.toHaveAttribute('aria-valuetext', 'Haze 40%');
		await expect
			.element(page.getByRole('slider', { name: 'Exposure' }))
			.toHaveAttribute('aria-valuetext', '+0.5 EV');
		fire(haze, '0.4', 'change');
		fire(exposure, '0.5', 'change');
		expect(sent).toHaveLength(3);
		await wait(300);
		expect(sent).toHaveLength(3);
	});

	it('throttles a drag to one send per 250 ms, then sends the release value', async () => {
		const sent = mount();
		await open();
		const haze = page.getByRole('slider', { name: 'Haze' }).element() as HTMLInputElement;
		for (const v of ['0.1', '0.2', '0.3']) fire(haze, v, 'input');
		expect(sent).toEqual([]);
		await wait(300);
		expect(sent).toEqual([{ type: 'world_set', patch: { haze: { density: 0.3 } } }]);
		for (const v of ['0.5', '0.6']) fire(haze, v, 'input');
		fire(haze, '0.7', 'change');
		expect(sent.at(-1)).toEqual({ type: 'world_set', patch: { haze: { density: 0.7 } } });
		await wait(300);
		expect(sent).toHaveLength(2);
	});

	it('keeps weather and grade disabled until they are drawn', async () => {
		mount();
		await open();
		await expect.element(page.getByRole('combobox', { name: 'Weather' })).toBeDisabled();
		await expect.element(page.getByRole('combobox', { name: 'Grade' })).toBeDisabled();
		await expect.element(page.getByRole('combobox', { name: 'Sky' })).toBeEnabled();
	});
});
