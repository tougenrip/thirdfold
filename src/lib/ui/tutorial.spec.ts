import { describe, expect, it } from 'vitest';
import {
	currentStep,
	loadProgress,
	NEW_PLAYER,
	record,
	saveProgress,
	sessionStep,
	signalOf,
	TUTORIAL,
	type TutorialProgress
} from './tutorial';

/** A Storage stand-in: just the calls the tutorial makes. */
function memory(initial: Record<string, string> = {}) {
	const items = new Map(Object.entries(initial));
	return {
		getItem: (key: string) => items.get(key) ?? null,
		setItem: (key: string, value: string) => void items.set(key, value),
		items
	};
}

describe('the first session', () => {
	it('starts every new player at the welcome, and then teaches one thing at a time', () => {
		expect(NEW_PLAYER).toEqual({ stage: 'welcome', done: [] });
		expect(sessionStep(NEW_PLAYER)).toBe(3);
		const learning: TutorialProgress = { ...NEW_PLAYER, stage: 'tutorial' };
		expect(currentStep(learning)?.id).toBe('move');
		expect(sessionStep(learning)).toBe(4);
	});

	it('counts what the player does at the table, in any order', () => {
		let p: TutorialProgress = { stage: 'tutorial', done: [] };
		p = record(p, 'look');
		expect(currentStep(p)?.id).toBe('move');
		p = record(p, 'move');
		expect(currentStep(p)?.id).toBe('interact');
		expect(record(p, 'move')).toBe(p);
		for (const s of TUTORIAL) p = record(p, s.id);
		expect(currentStep(p)).toBeNull();
		expect(sessionStep(p)).toBe(5);
	});

	it('knows which actions teach what', () => {
		expect(signalOf({ type: 'adventure_interact' })).toBe('interact');
		expect(signalOf({ type: 'adventure_sense' })).toBe('look');
		expect(signalOf({ type: 'chat_send' })).toBe('chat');
		expect(signalOf({ type: 'dice_roll' })).toBe('chat');
		// Walking is seen on the table, where a refused move doesn't count.
		expect(signalOf({ type: 'token_move' })).toBeNull();
	});

	it('stops counting once the player has started', () => {
		const started: TutorialProgress = { stage: 'done', done: [] };
		expect(record(started, 'move')).toBe(started);
	});

	it('remembers where a player got to at each table, and survives bad storage', () => {
		const storage = memory();
		expect(loadProgress(storage, 'ABCDEF')).toEqual(NEW_PLAYER);
		saveProgress(storage, 'ABCDEF', { stage: 'tutorial', done: ['move'] });
		expect(loadProgress(storage, 'ABCDEF')).toEqual({ stage: 'tutorial', done: ['move'] });
		expect(loadProgress(storage, 'GHJKLM')).toEqual(NEW_PLAYER);

		const bad = memory({
			'thirdfold:tutorial:ABCDEF': '{not json',
			'thirdfold:tutorial:GHJKLM': JSON.stringify({ stage: 'boss', done: [] }),
			'thirdfold:tutorial:NPQRST': JSON.stringify({ stage: 'tutorial', done: ['move', 'fly'] })
		});
		expect(loadProgress(bad, 'ABCDEF')).toEqual(NEW_PLAYER);
		expect(loadProgress(bad, 'GHJKLM')).toEqual(NEW_PLAYER);
		expect(loadProgress(bad, 'NPQRST')).toEqual({ stage: 'tutorial', done: ['move'] });
		const full = {
			setItem: () => {
				throw new Error('quota');
			}
		};
		expect(() => saveProgress(full, 'ABCDEF', NEW_PLAYER)).not.toThrow();
	});
});
