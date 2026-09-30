import { page, userEvent } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { Light } from '$lib/game/lights';
import type { RoomAction } from '$lib/net/room-connection.svelte';
import LightInspector from './LightInspector.svelte';

const LIGHT: Light = { id: 'l1', pos: { x: 3, y: 6 }, radius: 4, color: '#ffa04d', on: true };

function mount() {
	const sent: RoomAction[] = [];
	const done = { done: 0, removed: 0 };
	render(LightInspector, {
		light: LIGHT,
		send: (action) => (sent.push(action), true),
		onDone: () => done.done++,
		onRemove: () => done.removed++
	});
	return { sent, done };
}

/** Sets a range or colour input as a person letting go of it would. */
function change(input: Element, value: string) {
	(input as HTMLInputElement).value = value;
	input.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('the light inspector', () => {
	it('titles the light by its kind', async () => {
		mount();
		await expect.element(page.getByRole('heading', { name: 'Torch' })).toBeVisible();
	});

	it('sends one light_update carrying only the field each control changes', async () => {
		const { sent } = mount();
		await userEvent.click(page.getByRole('checkbox', { name: 'Lit' }));
		await userEvent.selectOptions(page.getByRole('combobox', { name: 'Kind' }), 'glow');
		await userEvent.click(page.getByRole('button', { name: 'Moonlight' }));
		change(page.getByLabelText('Any colour').element(), '#123456');
		change(page.getByRole('slider', { name: /Radius/ }).element(), '7');
		change(page.getByRole('slider', { name: /Intensity/ }).element(), '2.5');
		change(page.getByRole('slider', { name: /Height/ }).element(), '6');
		await userEvent.selectOptions(page.getByRole('combobox', { name: 'Flicker' }), 'pulse');
		await userEvent.click(page.getByRole('checkbox', { name: 'Casts shadows' }));
		await userEvent.click(page.getByRole('checkbox', { name: 'Draw a fixture' }));
		expect(sent).toEqual(
			[
				{ on: false },
				{ kind: 'glow' },
				{ color: '#b8c8ff' },
				{ color: '#123456' },
				{ radius: 7 },
				{ intensity: 2.5 },
				{ height: 6 },
				{ flicker: 'pulse' },
				{ shadows: false },
				{ fixture: false }
			].map((patch) => ({ type: 'light_update', lightId: 'l1', patch }))
		);
	});

	it('hands Remove and Done to the room view', async () => {
		const { sent, done } = mount();
		await userEvent.click(page.getByRole('button', { name: 'Remove' }));
		await userEvent.click(page.getByRole('button', { name: 'Done' }));
		expect(done).toEqual({ done: 1, removed: 1 });
		expect(sent).toEqual([]);
	});
});
