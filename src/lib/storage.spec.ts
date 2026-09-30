import { describe, expect, it } from 'vitest';
import { DEFAULT_MIX, loadMix, saveMix } from './audio/mix';
import { loadName } from './prefs';
import { guardStorage } from './storage';
import { DEFAULT_GRAPHICS, loadGraphics } from './tabletop/quality';
import { loadProgress } from './ui/tutorial';

const unset = () => delete (globalThis as { localStorage?: unknown }).localStorage;

describe('storage blocked outright', () => {
	it('is replaced by one that keeps nothing, so every setting reads as its default', () => {
		Object.defineProperty(globalThis, 'localStorage', {
			configurable: true,
			get() {
				throw new DOMException('blocked', 'SecurityError');
			}
		});
		try {
			expect(() => loadGraphics(localStorage)).toThrow();
			guardStorage();
			expect(loadGraphics(localStorage)).toEqual(DEFAULT_GRAPHICS);
			saveMix(localStorage, { ...DEFAULT_MIX, muted: true });
			expect(loadMix(localStorage)).toEqual(DEFAULT_MIX);
			expect(loadProgress(localStorage, 'room').stage).toBe('welcome');
			expect(loadName()).toBe('');
		} finally {
			unset();
		}
	});

	it('is left alone where storage works', () => {
		const storage = { getItem: () => '{"muted":true}', setItem: () => {} };
		Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
		try {
			guardStorage();
			expect(localStorage).toBe(storage);
			expect(loadMix(localStorage).muted).toBe(true);
		} finally {
			unset();
		}
	});
});
