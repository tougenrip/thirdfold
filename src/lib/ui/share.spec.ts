import { describe, expect, it } from 'vitest';
import { sharedCode, sharedLink } from './share';

const code = '0123456789abcdef0123456789abcdef';

describe('shared table links', () => {
	it('round-trips a code through a link, and reads a bare code', () => {
		const link = sharedLink('https://thirdfold.example', code);
		expect(link).toBe(`https://thirdfold.example/?table=${code}`);
		expect(sharedCode(link)).toBe(code);
		expect(sharedCode(`  ${code} `)).toBe(code);
	});

	it('reads nothing from anything else', () => {
		for (const text of ['', 'hello', 'https://x.example/?table=zz', `${code}0`, 'javascript:1']) {
			expect(sharedCode(text)).toBeNull();
		}
	});
});
