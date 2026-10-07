// Token bases' rings (#265): who wears which, the same for every viewer but the 'mine' twin, how
// bright they glow, and the seat colours kept apart in plain sight and under protanopia and
// deuteranopia (the enemy's red is exempt: its notched rim carries it).

import { describe, expect, it } from 'vitest';
import {
	BANDS,
	BASE_PALETTE,
	BASE_PROFILE,
	BASE_SIZES,
	baseDiameters,
	baseSizeFor,
	EMISSION,
	ENEMY,
	NEUTRAL,
	profileFor,
	PULSE,
	ringEmission,
	ringFor,
	ringsFor,
	SEATS,
	type RingContext
} from './bases';
import { oklabDistance } from './cvd';

/**
 * OKLab distance between any two seat colours, or a seat and the neutral grey: 0.07 is about
 * twice what reads as "the same colour" side by side, and Okabe and Ito's palette keeps above it
 * for the two common dichromacies.
 */
const MIN_DISTANCE = 0.07;

const players = [
	{ id: 'gm', role: 'gm' as const },
	{ id: 'ana', role: 'player' as const },
	{ id: 'eye', role: 'spectator' as const },
	{ id: 'bo', role: 'player' as const }
];
const ctx = (viewer: string | null, enemies: string[] = []): RingContext => ({
	players,
	viewer,
	enemies: new Set(enemies)
});

describe('rings', () => {
	it('give players their seat colour in join order, and the viewer a double ring on its own', () => {
		const ana = { id: 't1', ownerId: 'ana' };
		const bo = { id: 't2', ownerId: 'bo' };
		expect(ringFor(ana, ctx('ana'))).toEqual({ colour: 0, notched: false, double: true });
		expect(ringFor(bo, ctx('ana'))).toEqual({ colour: 1, notched: false, double: false });
		expect(ringFor(bo, ctx('bo')).double).toBe(true);
	});

	it('are the same colour for every viewer', () => {
		const tokens = [
			{ id: 't1', ownerId: 'ana' },
			{ id: 't2', ownerId: 'bo' },
			{ id: 'npc', ownerId: null },
			{ id: 'hound', ownerId: null }
		];
		const colours = (viewer: string | null) =>
			[...ringsFor(tokens, ctx(viewer, ['hound'])).values()].map((r) => [r.colour, r.notched]);
		for (const viewer of ['gm', 'ana', 'bo', 'eye', null])
			expect(colours(viewer)).toEqual(colours('gm'));
	});

	it('make enemies red and notched, everything else neutral', () => {
		expect(ringFor({ id: 'hound', ownerId: null }, ctx('ana', ['hound']))).toEqual({
			colour: ENEMY,
			notched: true,
			double: false
		});
		// A sentry outside a fight, an NPC and a GM's token.
		expect(ringFor({ id: 'hound', ownerId: null }, ctx('ana')).colour).toBe(NEUTRAL);
		expect(ringFor({ id: 'gm-t', ownerId: 'gm' }, ctx('gm'))).toEqual({
			colour: NEUTRAL,
			notched: false,
			double: false
		});
	});

	it('repeat the colours past six seats', () => {
		const many = Array.from({ length: 8 }, (_, i) => ({ id: `p${i}`, role: 'player' as const }));
		const ring = ringFor(
			{ id: 't', ownerId: 'p7' },
			{ players: many, viewer: null, enemies: new Set() }
		);
		expect(ring.colour).toBe(7 % SEATS);
	});

	it('glow brighter hovered, brightest selected, and pulse on the turn unless still', () => {
		const none = { hovered: false, selected: false, active: false };
		expect(ringEmission(none, 0, false)).toBe(EMISSION.rest);
		expect(ringEmission({ ...none, hovered: true }, 0, false)).toBe(1);
		expect(ringEmission({ ...none, hovered: true, selected: true }, 0, false)).toBe(1.6);
		const active = { ...none, active: true };
		const period = 1000 / PULSE.hz;
		expect(ringEmission(active, 0, false)).toBeCloseTo(PULSE.low);
		expect(ringEmission(active, period / 2, false)).toBeCloseTo(PULSE.high);
		// Under three flashes a second (WCAG 2.3.1).
		expect(PULSE.hz).toBeLessThan(3);
		const steady = ringEmission(active, 0, true);
		expect(ringEmission(active, period / 3, true)).toBe(steady);
		expect(steady).toBeGreaterThan(PULSE.low);
	});

	it('keep the seat colours apart, and from the neutral grey, as they are and under protan and deutan', () => {
		const colours = [...BASE_PALETTE.slice(0, SEATS), BASE_PALETTE[NEUTRAL]];
		for (const kind of [null, 'protanopia', 'deuteranopia'] as const)
			for (let i = 0; i < colours.length; i++)
				for (let j = i + 1; j < colours.length; j++)
					expect(
						oklabDistance(colours[i], colours[j], kind),
						`${kind} ${i}/${j}`
					).toBeGreaterThanOrEqual(MIN_DISTANCE);
	});
});

describe('the base profile', () => {
	it('is 0.86 across and 0.1 tall, with the bands in order', () => {
		expect(Math.max(...BASE_PROFILE.map(([r]) => r)) * 2).toBeCloseTo(0.86);
		expect(Math.max(...BASE_PROFILE.map(([, y]) => y))).toBeCloseTo(0.1);
		expect(BANDS.rim).toBeLessThan(BANDS.ring[0]);
		expect(BANDS.ring[0]).toBeLessThan(BANDS.ring[1]);
		expect(BANDS.ring[1]).toBeLessThanOrEqual(BANDS.disc);
		// Lathed in this order, the top and the edge face up and out (LatheGeometry's normals).
		const [a, b] = BASE_PROFILE.slice(-2);
		expect(b[0] - a[0]).toBeLessThan(0); // inward along the top: its normal points up
	});
});

describe('base sizes (#270)', () => {
	it('picks 0.86, 1.9, 2.9 or 3.9 by scale', () => {
		expect([undefined, 0.5, 1, 1.49].map(baseSizeFor)).toEqual([0.86, 0.86, 0.86, 0.86]);
		expect([1.5, 1.8, 2.49].map(baseSizeFor)).toEqual([1.9, 1.9, 1.9]);
		expect([2.5, 2.6, 3].map(baseSizeFor)).toEqual([2.9, 2.9, 2.9]);
		expect(baseSizeFor(3.5)).toBe(3.9);
	});

	const keeper = { id: 'k', pos: { x: 5, y: 5 }, scale: 1.8 };
	const at = (x: number, y: number, id = 'c') => ({ id, pos: { x, y } });

	it('keeps a large base when nobody stands under it', () => {
		const d = baseDiameters([keeper, at(5, 7), at(6, 6)]);
		expect(d.get('k')).toBe(1.9); // two cells off, and diagonal (1.41 > 0.95 + 0.43)
		expect(d.get('c')).toBe(0.86);
	});

	it('shrinks to 0.86 with another mini beside it, by distance', () => {
		expect(baseDiameters([keeper, at(6, 5)]).get('k')).toBe(0.86);
		const hand = { id: 'h', pos: { x: 5, y: 5 }, scale: 2.6 };
		expect(baseDiameters([hand, at(6, 6)]).get('h')).toBe(0.86); // 1.41 < 1.45 + 0.43
		expect(baseDiameters([hand, at(7, 5)]).get('h')).toBe(2.9); // 2 > 1.88
	});

	it('does not shrink for a mini more than a level above or below', () => {
		const level = (p: { x: number }) => (p.x === 6 ? 2 : 0);
		expect(baseDiameters([keeper, at(6, 5)], level).get('k')).toBe(1.9);
		expect(baseDiameters([keeper, at(6, 5)], (p) => (p.x === 6 ? 1 : 0)).get('k')).toBe(0.86);
	});

	it("keeps the bands' widths at every size, widening the disc", () => {
		for (const d of BASE_SIZES) {
			const p = profileFor(d);
			expect(p[0][0] * 2).toBeCloseTo(d);
			expect(p[0][0] - p[3][0]).toBeCloseTo(BASE_PROFILE[0][0] - BASE_PROFILE[3][0]);
			expect(p.at(-1)![0]).toBe(0);
		}
	});
});
