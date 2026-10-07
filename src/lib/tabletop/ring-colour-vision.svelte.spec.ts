// G6 on the picture (#278): the seat rings (#265) stay told apart on screen under the three
// dichromacies. crowd-60's GM view at its close pose, every mini given a seat in turn (its tokens
// handed out among six players here, the fixture unchanged) and two made enemies; each token's base
// centre is projected, the ring's near arc sampled, and each seat's colour (the median over its
// tokens, so a mini in front of one ring doesn't decide it) must lie the agreed OKLab distance
// (bases.ts `RING_DISTANCE`) from every other seat's, as drawn and after Machado 2009's protan,
// deutan and tritan simulation (cvd.ts). Enemies are exempt: the notch tells them apart, which
// the goldens check. bases.spec.ts holds the palette itself to the same distance.

import * as THREE from 'three/webgpu';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { gridToWorld } from '$lib/game/grid';
import { BASE_PALETTE, BASE_PROFILE, ringsFor, RING_DISTANCE, SEATS } from './bases';
import { linear, oklab, oklabDistance, type Deficiency } from './cvd';
import {
	HEIGHT,
	WIDTH,
	loadSidecar,
	loadView,
	manualClock,
	mountFixture,
	readFrame,
	settle,
	type Mounted
} from './testing';

vi.setConfig({ testTimeout: 300_000, hookTimeout: 90_000 });

let mounted: Mounted | null = null;
afterEach(async () => {
	await mounted?.unmount();
	mounted = null;
});

/**
 * Pairs that fall short on screen today, reported on #278 rather than recoloured here (the palette
 * is #265's, and the M71 look is signed off): bluish green and reddish purple under deuteranopia,
 * 0.053 drawn (0.076 in the palette). Expected to stay short: when the colours change and it
 * passes, this fails instead, so the list is kept honest.
 */
const KNOWN_SHORT = new Set(['deuteranopia 2/5']);

const KINDS: (Deficiency | null)[] = [null, 'protanopia', 'deuteranopia', 'tritanopia'];
/** The ring's middle and top, cell units (BASE_PROFILE's points 4 and 5). */
const RING_R = (BASE_PROFILE[4][0] + BASE_PROFILE[5][0]) / 2;
const RING_Y = BASE_PROFILE[4][1];
/**
 * Sample angles round the ring from the camera's bearing: its sides, where neither the lip in
 * front (the ring is set in below it) nor the mini behind hides it.
 */
const ARC = [-110, -90, -70, -50, 50, 70, 90, 110].map((d) => (d * Math.PI) / 180);

const hex = ([r, g, b]: number[]) => (r << 16) | (g << 8) | b;
/** How far apart two colours' OKLab hues lie, in radians. */
function hueGap(a: number, b: number): number {
	const [p, q] = [a, b].map((c) => oklab(linear(c)));
	const d = Math.abs(Math.atan2(p[2], p[1]) - Math.atan2(q[2], q[1]));
	return Math.min(d, 2 * Math.PI - d);
}
const median = (xs: number[]) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const medianColour = (cs: number[][]) => [0, 1, 2].map((i) => median(cs.map((c) => c[i])));
/** Samples that look alike: within this OKLab distance of each other. */
const ALIKE = 0.04;

/**
 * A seat's ring colour from all its samples: the median of the largest group that look alike.
 * Whatever stands in front of a ring (a mini, its base's lip, another base) differs from token to
 * token, while the rings of one seat are one colour, so they make the largest group.
 */
function ringColour(samples: number[][]): number {
	const hexes = samples.map(hex);
	const near = hexes.map((a) => samples.filter((_, j) => oklabDistance(a, hexes[j]) < ALIKE));
	return hex(medianColour(near.reduce((best, n) => (n.length > best.length ? n : best))));
}

describe('seat rings under colour-vision deficiency', () => {
	it('keep different owners the agreed OKLab distance apart on screen', async () => {
		const sidecar = await loadSidecar('crowd-60');
		const view = await loadView('crowd-60', 'day', 'gm');
		mounted = await mountFixture(view, sidecar.poses.close, { clock: manualClock(5000) });
		const players = [
			{ id: 'gm', role: 'gm' as const },
			...Array.from({ length: SEATS }, (_, i) => ({ id: `seat-${i}`, role: 'player' as const }))
		];
		const enemies = new Set(view.tokens.slice(0, 2).map((t) => t.id));
		const seated = view.tokens.map((t, i) => ({ id: t.id, ownerId: `seat-${i % SEATS}` }));
		const rings = ringsFor(seated, { players, viewer: 'gm', enemies });
		mounted.tabletop.setRings(rings);
		await settle(mounted.tabletop);
		const pixel = await readFrame(mounted.canvas, WIDTH, HEIGHT);

		const pose = mounted.tabletop.cameraPose()!;
		const camera = new THREE.PerspectiveCamera(45, WIDTH / HEIGHT, 0.1, 1000);
		camera.position.set(pose.position.x, pose.position.y, pose.position.z);
		camera.lookAt(pose.target.x, pose.target.y, pose.target.z);
		camera.updateMatrixWorld();
		const size = view.grid.cellSize;
		const bySeat = new Map<number, number[][]>();
		for (const token of view.tokens) {
			const ring = rings.get(token.id)!;
			if (ring.notched) continue; // an enemy: the notch carries it
			const c = gridToWorld(view.grid, token.pos);
			const bearing = Math.atan2(pose.position.z - c.z, pose.position.x - c.x);
			const samples = ARC.flatMap((a) => {
				const at = new THREE.Vector3(
					c.x + Math.cos(bearing + a) * RING_R * size,
					RING_Y * size,
					c.z + Math.sin(bearing + a) * RING_R * size
				).project(camera);
				const [x, y] = [((at.x + 1) / 2) * WIDTH, ((1 - at.y) / 2) * HEIGHT].map(Math.floor);
				return at.z < 1 && x >= 0 && x < WIDTH && y >= 0 && y < HEIGHT ? [pixel(x, y)] : [];
			});
			bySeat.set(ring.colour, [...(bySeat.get(ring.colour) ?? []), ...samples]);
		}
		expect([...bySeat.keys()].sort(), 'every seat in the frame').toEqual([0, 1, 2, 3, 4, 5]);
		const seats = [...bySeat].map(([seat, cs]) => [seat, ringColour(cs)] as const);

		// The sampler found the rings: each seat drawn nearest its own palette colour in hue (the
		// light and the grade move its lightness and chroma).
		for (const [seat, drawn] of seats) {
			const near = BASE_PALETTE.slice(0, SEATS).map((p) => hueGap(drawn, p));
			expect
				.soft(near.indexOf(Math.min(...near)), `seat ${seat} drawn as #${drawn.toString(16)}`)
				.toBe(seat);
		}
		for (const kind of KINDS)
			for (const [i, a] of seats)
				for (const [j, b] of seats) {
					if (i >= j) continue;
					const pair = `${kind ?? 'as drawn'} ${i}/${j}`;
					const d = oklabDistance(a, b, kind);
					if (KNOWN_SHORT.has(pair))
						expect.soft(d, `${pair} (known short)`).toBeLessThan(RING_DISTANCE);
					else expect.soft(d, pair).toBeGreaterThanOrEqual(RING_DISTANCE);
				}
	});
});
