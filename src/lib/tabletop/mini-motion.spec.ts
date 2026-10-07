import { describe, expect, it } from 'vitest';
import {
	BOB,
	BOB_MS,
	FALL_MS,
	HOP_MAX,
	HOP_MIN,
	LYING,
	PICK_MS,
	SQUASH,
	SQUASH_MS,
	STAND_MS,
	bobs,
	fall,
	miniPose,
	moveMs,
	phaseOf,
	pick,
	restingMotion,
	startMove
} from './mini-motion';

const AT_REST = { along: 1, hop: 0, pick: 0, squash: 1, bob: 0, fall: 0, busy: false };

describe('mini motion (#272)', () => {
	it('rests exactly on its cell', () => {
		expect(miniPose(restingMotion('a'), 1234, false)).toEqual(AT_REST);
		const m = restingMotion('a');
		startMove(m, 1000, 3);
		const end = 1000 + moveMs(3) + SQUASH_MS;
		expect(miniPose(m, end, false)).toEqual(AT_REST);
		expect(miniPose(m, end + 5000, false)).toEqual(AT_REST);
	});

	it('hops higher for longer moves, peaking mid-move, and squashes on landing', () => {
		const short = restingMotion('a');
		startMove(short, 0, 1);
		const long = restingMotion('a');
		startMove(long, 0, 8);
		expect(short.hop).toBeCloseTo(HOP_MIN);
		expect(long.hop).toBe(HOP_MAX);
		const mid = miniPose(long, moveMs(8) / 2, false);
		expect(mid.hop).toBeCloseTo(HOP_MAX);
		expect(mid.along).toBeCloseTo(0.5);
		expect(mid.busy).toBe(true);
		const landing = miniPose(long, moveMs(8) + SQUASH_MS / 2, false);
		expect(landing.along).toBe(1);
		expect(landing.hop).toBe(0);
		expect(landing.squash).toBeCloseTo(1 - SQUASH);
		expect(landing.busy).toBe(true);
	});

	it('lifts when picked up and settles when put down, from wherever it was', () => {
		const m = restingMotion('a');
		expect(pick(m, true, 0, false)).toBe(true);
		expect(pick(m, true, 10, false)).toBe(false);
		expect(miniPose(m, PICK_MS, false)).toMatchObject({ pick: 1, busy: false });
		const half = miniPose(m, PICK_MS / 2, false).pick;
		expect(half).toBeGreaterThan(0.5); // eased out
		pick(m, false, 1000, false);
		expect(miniPose(m, 1000, false).pick).toBe(1); // no jump
		expect(miniPose(m, 1000 + PICK_MS, false)).toEqual(AT_REST);
	});

	it('tips over with a bounce and stands back up', () => {
		const m = restingMotion('a');
		fall(m, true, 0);
		expect(miniPose(m, 0, false).fall).toBe(0);
		const angles = Array.from(
			{ length: 36 },
			(_, i) => miniPose(m, (i * FALL_MS) / 35, false).fall
		);
		expect(Math.max(...angles)).toBeCloseTo(LYING, 1);
		const bounced = angles.slice(26, 35).some((a) => a < LYING - 0.05);
		expect(bounced).toBe(true);
		expect(miniPose(m, FALL_MS, false)).toMatchObject({ fall: LYING, busy: false });
		fall(m, false, 1000);
		expect(miniPose(m, 1000, false).fall).toBe(LYING);
		expect(miniPose(m, 1000 + STAND_MS, false)).toEqual(AT_REST);
	});

	it('lies down at once when it just came onto the table', () => {
		const m = restingMotion('a');
		fall(m, true, 50, true);
		expect(miniPose(m, 50, false)).toMatchObject({ fall: LYING, busy: false });
	});

	it('bobs a flier on a phase stable per token', () => {
		expect(phaseOf('hound-1')).toBe(phaseOf('hound-1'));
		expect(phaseOf('hound-1')).not.toBe(phaseOf('hound-2'));
		expect(phaseOf('x')).toBeGreaterThanOrEqual(0);
		expect(phaseOf('x')).toBeLessThan(2 * Math.PI);
		const m = restingMotion('bat', true);
		expect(bobs(m, false)).toBe(true);
		const bob = Array.from({ length: 24 }, (_, i) => miniPose(m, (i * BOB_MS) / 24, false).bob);
		expect(Math.max(...bob)).toBeLessThanOrEqual(BOB);
		expect(Math.min(...bob)).toBeGreaterThanOrEqual(-BOB);
		expect(Math.max(...bob) - Math.min(...bob)).toBeGreaterThan(BOB);
		expect(miniPose(m, 0, false).busy).toBe(false); // the bob alone is ambient
		expect(miniPose(m, BOB_MS, false).bob).toBeCloseTo(miniPose(m, 0, false).bob);
	});

	it('under reduced motion: flat glides, no squash, tilt or bob, and a still fall', () => {
		const m = restingMotion('bat', true);
		expect(bobs(m, true)).toBe(false);
		startMove(m, 0, 4);
		const mid = miniPose(m, moveMs(4) / 2, true);
		expect(mid).toMatchObject({ hop: 0, squash: 1, bob: 0, busy: true });
		expect(mid.along).toBeCloseTo(0.5);
		expect(miniPose(m, moveMs(4) + SQUASH_MS / 2, true)).toEqual(AT_REST);
		pick(m, true, 2000, true);
		expect(miniPose(m, 2000, true)).toEqual(AT_REST);
		fall(m, true, 3000);
		expect(miniPose(m, 3000, true)).toEqual({ ...AT_REST, fall: LYING });
		fall(m, false, 4000);
		expect(miniPose(m, 4000, true)).toEqual(AT_REST);
	});
});
