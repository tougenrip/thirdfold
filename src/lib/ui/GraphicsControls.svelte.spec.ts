import { page, userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { DEFAULT_GRAPHICS, loadGraphics, saveGraphics } from '$lib/tabletop/quality';
import GraphicsControls from './GraphicsControls.svelte';

afterEach(() => localStorage.removeItem('thirdfold:graphics'));

/** The menu as the room shows it: its choice saved in this browser. */
function mount(backend: 'webgpu' | 'webgl2' = 'webgpu') {
	return render(GraphicsControls, {
		graphics: loadGraphics(localStorage),
		effective: { tier: 'medium', backend },
		onchange: (next) => saveGraphics(localStorage, next)
	});
}

describe('the Graphics menu', () => {
	it('shows what Auto picked and picks a tier by keyboard', async () => {
		mount();
		await userEvent.click(page.getByRole('button', { name: 'Graphics settings' }));
		const auto = page.getByRole('radio', { name: 'Auto (Medium)' });
		await expect.element(auto).toBeChecked();
		(auto.element() as HTMLInputElement).focus();
		await userEvent.keyboard('{ArrowDown}');
		expect(loadGraphics(localStorage).tier).toBe('low');
	});

	it('keeps the choice across a remount', async () => {
		saveGraphics(localStorage, { ...DEFAULT_GRAPHICS, tier: 'high', powerSaver: true });
		mount();
		await userEvent.click(page.getByRole('button', { name: 'Graphics settings' }));
		await expect.element(page.getByRole('radio', { name: 'High' })).toBeChecked();
		await expect.element(page.getByRole('checkbox', { name: /Power saver/ })).toBeChecked();
	});

	it('closes on Escape and gives focus back to its button', async () => {
		mount();
		const button = page.getByRole('button', { name: 'Graphics settings' });
		await userEvent.click(button);
		await expect.element(button).toHaveAttribute('aria-expanded', 'true');
		await userEvent.keyboard('{Escape}');
		await expect.element(button).toHaveAttribute('aria-expanded', 'false');
		await expect.element(button).toHaveFocus();
	});

	it('disables Ultra, saying why, when the table draws with WebGL2', async () => {
		mount('webgl2');
		await userEvent.click(page.getByRole('button', { name: 'Graphics settings' }));
		await expect.element(page.getByRole('radio', { name: 'Ultra' })).toBeDisabled();
		await expect.element(page.getByText(/Ultra needs WebGPU/)).toBeInTheDocument();
	});

	it('keeps an option changed apart from the preset, until a preset is chosen', async () => {
		mount();
		await userEvent.click(page.getByRole('button', { name: 'Graphics settings' }));
		await userEvent.click(page.getByText('Advanced'));
		await userEvent.selectOptions(page.getByRole('combobox', { name: 'Ambient occlusion' }), 'Off');
		expect(loadGraphics(localStorage).overrides).toEqual({ ao: false });
		await userEvent.click(page.getByRole('radio', { name: 'High' }));
		expect(loadGraphics(localStorage)).toMatchObject({ tier: 'high', overrides: {} });
	});

	it('turns every lens effect off with Clarity, and only those', async () => {
		saveGraphics(localStorage, { ...DEFAULT_GRAPHICS, overrides: { bloom: false } });
		mount();
		await userEvent.click(page.getByRole('button', { name: 'Graphics settings' }));
		const clarity = page.getByRole('button', { name: 'Clarity: no lens effects' });
		await expect.element(clarity).toHaveAttribute('aria-pressed', 'false');
		await userEvent.click(clarity);
		expect(loadGraphics(localStorage).overrides).toEqual({
			bloom: false,
			vignette: false,
			aberration: false,
			grain: false
		});
		// Miniature is off in every preset already: nothing to keep.
	});

	it('saves Always show grid, off by default', async () => {
		mount();
		await userEvent.click(page.getByRole('button', { name: 'Graphics settings' }));
		const always = page.getByRole('checkbox', { name: /Always show grid/ });
		await expect.element(always).not.toBeChecked();
		await userEvent.click(always);
		expect(loadGraphics(localStorage).alwaysGrid).toBe(true);
	});

	it('forgets an option set back to the value of its preset', async () => {
		saveGraphics(localStorage, { ...DEFAULT_GRAPHICS, overrides: { aa: 'off' } });
		mount();
		await userEvent.click(page.getByRole('button', { name: 'Graphics settings' }));
		await expect.element(page.getByText('Preset (customised)')).toBeInTheDocument();
		await userEvent.selectOptions(page.getByRole('combobox', { name: 'Antialiasing' }), 'MSAA 4×');
		expect(loadGraphics(localStorage).overrides).toEqual({});
	});

	it('picks the tone mapper, saved, Filmic by default', async () => {
		mount();
		await userEvent.click(page.getByRole('button', { name: 'Graphics settings' }));
		await expect.element(page.getByRole('radio', { name: 'Filmic (ACES)' })).toBeChecked();
		await userEvent.click(page.getByRole('radio', { name: 'Soft (AgX)' }));
		expect(loadGraphics(localStorage).toneMapper).toBe('agx');
	});

	it('asks for a reload to switch the backend, and saves it', async () => {
		mount();
		await userEvent.click(page.getByRole('button', { name: 'Graphics settings' }));
		await userEvent.click(page.getByRole('checkbox', { name: /Compatibility mode/ }));
		expect(loadGraphics(localStorage).compatibility).toBe(true);
	});
});
