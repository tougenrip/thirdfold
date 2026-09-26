import { describe, expect, it } from 'vitest';
import { FLASH_MS } from '$lib/game/chat';
import { EffectsLayer } from './effects';

describe('the flash', () => {
	it('lights the table for exactly as long as the server does, then ends', () => {
		const fx = new EffectsLayer();
		const t = 1000;
		fx.play('flash', t, false);
		const during = fx.tick(t + FLASH_MS - 1);
		expect(during.active).toBe(true);
		expect(during.flash).toBeGreaterThan(0);
		const after = fx.tick(t + FLASH_MS);
		expect(after.active).toBe(false);
		expect(after.flash).toBe(0);
		fx.dispose();
	});
});
