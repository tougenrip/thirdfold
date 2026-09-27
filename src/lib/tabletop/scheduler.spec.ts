import { describe, expect, it } from 'vitest';
import {
	AMBIENT_MS,
	frameDue,
	frameInterval,
	modeFor,
	SLOW_AFTER_MS,
	SLOW_AMBIENT_MS,
	type Situation
} from './scheduler';

const still: Situation = {
	active: false,
	ambient: false,
	converging: 0,
	hidden: false,
	reducedMotion: false,
	powerSaver: false
};
const pacing = { fpsCap: 60, ambientFps: 30, convergeFrames: 4 };
const low = { fpsCap: 30, ambientFps: 20, convergeFrames: 0 };

describe('the render scheduler', () => {
	it('stays idle when nothing moves or animates', () => {
		expect(modeFor(still)).toBe('idle');
		expect(frameInterval('idle', pacing, 0)).toBeNull();
		expect(frameDue(10_000, 0, null)).toBe(false);
	});

	it('caps active frames at the tier rate: 60, or 30 on low', () => {
		const active = modeFor({ ...still, active: true });
		expect(active).toBe('active');
		const at60 = frameInterval(active, pacing, 0)!;
		expect(frameDue(1000 / 144, 0, at60)).toBe(false); // a 144 Hz callback is skipped
		expect(frameDue(1000 / 60, 0, at60)).toBe(true);
		const at30 = frameInterval(active, low, 0)!;
		expect(frameDue(1000 / 60, 0, at30)).toBe(false);
		expect(frameDue(1000 / 30, 0, at30)).toBe(true);
	});

	it('runs ambient animation at 12.5 fps, 10 after a minute without input', () => {
		const ambient = modeFor({ ...still, ambient: true });
		expect(ambient).toBe('ambient');
		expect(frameInterval(ambient, pacing, 0)).toBe(AMBIENT_MS);
		expect(frameInterval(ambient, pacing, SLOW_AFTER_MS)).toBe(SLOW_AMBIENT_MS);
		expect(frameInterval(ambient, { ...pacing, ambientFps: 5 }, 0)).toBe(200);
	});

	it('draws no ambient frame when hidden, off screen, under reduced motion or power saver', () => {
		for (const off of [{ hidden: true }, { reducedMotion: true }, { powerSaver: true }])
			expect(modeFor({ ...still, ambient: true, ...off })).toBe('idle');
	});

	it('converges for the frames owed, then stops; not while hidden', () => {
		expect(modeFor({ ...still, converging: 2 })).toBe('converge');
		expect(modeFor({ ...still, converging: 0, ambient: false })).toBe('idle');
		expect(modeFor({ ...still, converging: 2, hidden: true })).toBe('idle');
		expect(frameInterval('converge', pacing, 0)).toBeCloseTo(1000 / 60);
	});
});
