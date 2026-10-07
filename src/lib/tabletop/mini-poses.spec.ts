import { describe, expect, it } from 'vitest';
import { poseOf } from './mini-poses';

const still = { downed: false, active: false };

describe('poseOf', () => {
	it('shows the downed pose for a fallen character, the active one on its turn', () => {
		const poses = { downed: 1, active: 2 } as const;
		expect(poseOf(still, poses)).toBe(0);
		expect(poseOf({ downed: true, active: false }, poses)).toBe(1);
		expect(poseOf({ downed: false, active: true }, poses)).toBe(2);
		// Down on its own turn: still down.
		expect(poseOf({ downed: true, active: true }, poses)).toBe(1);
	});

	it('keeps the body when the model has no pose for the state', () => {
		expect(poseOf({ downed: true, active: true }, undefined)).toBe(0);
		expect(poseOf({ downed: true, active: false }, { active: 3 })).toBe(0);
		expect(poseOf({ downed: false, active: true }, { downed: 2 })).toBe(0);
	});
});
