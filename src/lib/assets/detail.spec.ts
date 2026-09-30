import { describe, expect, it, vi } from 'vitest';
import { fileAt, sizeFor, sizesOf, textureDetailFrom } from './detail';
import { Retargeter, type Tracked } from './retarget';
import type { Variant } from './manifest';

const variant = (size: 1024 | 2048): Variant => ({
	size,
	file: `textures/stone-${size / 1024}k.0000000${size / 1024}.ktx2`,
	sha256: `0000000${size / 1024}`.padEnd(64, '0'),
	bytes: 1,
	gpuBytes: 1,
	credit: { license: 'CC0-1.0', author: 'x' }
});
const base = { file: 'textures/stone.00000000.ktx2', sha256: '0'.repeat(64) };

describe('texture detail', () => {
	it('picks the largest size up to the setting, the base below every variant', () => {
		const both = sizesOf({ ...base, variants: [variant(1024), variant(2048)] });
		expect(both).toEqual([512, 1024, 2048]);
		expect(sizeFor(both, 'low')).toBe(512);
		expect(sizeFor(both, 'medium')).toBe(1024);
		expect(sizeFor(both, 'high')).toBe(2048);
		// Only a 1K copy: high draws it; none: every setting draws the base.
		const one = sizesOf({ ...base, variants: [variant(1024)] });
		expect(sizeFor(one, 'high')).toBe(1024);
		expect(sizeFor(sizesOf(base), 'high')).toBe(512);
	});

	it('names the file of a size, the base for its own', () => {
		const entry = { ...base, variants: [variant(1024), variant(2048)] };
		expect(fileAt(entry, 2048).file).toBe('textures/stone-2k.00000002.ktx2');
		expect(fileAt(entry, 512).file).toBe(base.file);
	});

	it('reads ?texture=', () => {
		expect(textureDetailFrom('?texture=medium')).toBe('medium');
		expect(textureDetailFrom('?texture=ultra')).toBeNull();
	});

	it('follows the setting, and falls back to the base when a copy fails to load', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const loaded: number[] = [];
		const item: Tracked = {
			sizes: [512, 1024, 2048],
			current: 512,
			load: async (size) => {
				if (size === 2048) throw new Error('HTTP 404');
				loaded.push(size);
			}
		};
		const r = new Retargeter('low');
		await r.track(item);
		expect(loaded).toEqual([]); // the base is what it loaded with
		await r.set('medium');
		expect([item.current, loaded]).toEqual([1024, [1024]]);
		await r.set('high'); // the 2K copy fails: back to the base
		expect([item.current, loaded]).toEqual([512, [1024, 512]]);
		expect(warn).toHaveBeenCalled();
		await r.set('low');
		expect(loaded).toEqual([1024, 512]); // already the base
		warn.mockRestore();
	});
});
