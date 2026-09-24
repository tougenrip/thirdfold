import { describe, expect, it } from 'vitest';
import { CHAT_MAX_LENGTH, normalizeChatText, parseChatInput } from './chat';

describe('normalizeChatText', () => {
	it('trims, collapses whitespace and strips control characters', () => {
		expect(normalizeChatText('  hello\n\tthere \u0007 ')).toBe('hello there');
	});

	it('keeps markup as literal text', () => {
		expect(normalizeChatText('<img src=x onerror=alert(1)>')).toBe('<img src=x onerror=alert(1)>');
	});

	it('rejects empty, oversized and non-string input', () => {
		expect(normalizeChatText(' \n ')).toBeNull();
		expect(normalizeChatText('x'.repeat(CHAT_MAX_LENGTH + 1))).toBeNull();
		expect(normalizeChatText(42)).toBeNull();
	});
});

describe('parseChatInput', () => {
	it('turns /roll and /r into rolls', () => {
		expect(parseChatInput('/roll 2d6+3')).toEqual({
			type: 'roll',
			expression: '2d6+3',
			secret: false
		});
		expect(parseChatInput('/r d20')).toEqual({ type: 'roll', expression: 'd20', secret: false });
		expect(parseChatInput('/ROLL')).toEqual({ type: 'roll', expression: '1d20', secret: false });
	});

	it('rolls in secret with /gmroll or /gr', () => {
		expect(parseChatInput('/gmroll 1d20+2')).toEqual({
			type: 'roll',
			expression: '1d20+2',
			secret: true
		});
		expect(parseChatInput('/gr')).toEqual({ type: 'roll', expression: '1d20', secret: true });
		expect(parseChatInput('/grr')).toEqual({ type: 'chat', text: '/grr' });
	});

	it('leaves everything else as chat', () => {
		expect(parseChatInput('rolling now')).toEqual({ type: 'chat', text: 'rolling now' });
		expect(parseChatInput('/rolled')).toEqual({ type: 'chat', text: '/rolled' });
	});
});
