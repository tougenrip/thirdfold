import { describe, expect, it } from 'vitest';
import { SHOT_MS, SHOT_TOTAL, shotAt, shotPose, type Pose } from './shots';

const home: Pose = { position: { x: 0, y: 20, z: 10 }, target: { x: 0, y: 0, z: 0 } };
const focus = { x: 5, y: 0, z: -4 };
const dist = (p: Pose) =>
	Math.hypot(p.position.x - p.target.x, p.position.y - p.target.y, p.position.z - p.target.z);

describe('a cinematic shot', () => {
	it('looks at its focus, from the same side of the table the viewer was looking from', () => {
		const close = shotPose(home, focus, 'close', 30, 1);
		expect(close.target).toEqual(focus);
		// The viewer looked from +z; the shot still does.
		expect(close.position.z).toBeGreaterThan(focus.z);
		expect(close.position.x).toBeCloseTo(focus.x);
		expect(close.position.y).toBeGreaterThan(0);
	});

	it('frames close nearer than wide, and pulls right back over the whole table for its scale', () => {
		const close = shotPose(home, focus, 'close', 30, 1);
		const wide = shotPose(home, focus, 'wide', 30, 1);
		const table = shotPose(home, focus, 'table', 30, 1);
		expect(dist(close)).toBeLessThan(dist(wide));
		expect(dist(wide)).toBeLessThan(dist(table));
		expect(table.target).toEqual({ x: 0, y: 0, z: 0 });
		expect(dist(table)).toBeGreaterThan(30);
	});

	it('copes with a camera looking straight down', () => {
		const overhead: Pose = { position: { x: 0, y: 30, z: 0 }, target: { x: 0, y: 0, z: 0 } };
		const pose = shotPose(overhead, focus, 'close', 30, 1);
		expect(Number.isFinite(pose.position.x + pose.position.y + pose.position.z)).toBe(true);
	});

	it('goes there, holds, and gives the camera back where it was', () => {
		const to = shotPose(home, focus, 'close', 30, 1);
		expect(shotAt(home, to, 0)).toEqual({ pose: home, done: false });
		const halfway = shotAt(home, to, SHOT_MS.go / 2).pose;
		expect(halfway.target.x).toBeGreaterThan(0);
		expect(halfway.target.x).toBeLessThan(focus.x);
		expect(shotAt(home, to, SHOT_MS.go + 10).pose).toEqual(to);
		expect(shotAt(home, to, SHOT_TOTAL)).toEqual({ pose: home, done: true });
		// A few seconds at most: a moment, not a cutscene.
		expect(SHOT_TOTAL).toBeLessThanOrEqual(6000);
	});
});
