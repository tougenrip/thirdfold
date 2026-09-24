import { describe, expect, it } from 'vitest';
import { GM_KEY_PATTERN } from '../src/lib/game/protocol';
import { keyOwner, newGmKey } from './gm-keys';

describe('GM keys', () => {
	it('are long random secrets, and saves are owned by their hash, never the key', () => {
		const key = newGmKey();
		expect(key).toMatch(GM_KEY_PATTERN);
		expect(newGmKey()).not.toBe(key);
		const owner = keyOwner(key);
		expect(owner).toMatch(/^[0-9a-f]{64}$/);
		expect(owner).not.toBe(key);
		expect(keyOwner(key)).toBe(owner);
	});
});
