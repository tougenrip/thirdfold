import { describe, expect, it } from 'vitest';
import type { SquareGrid } from './grid';
import {
	CARRIED_LIGHT_COLOR,
	CORE_MAX,
	FALLOFF,
	FALLOFF_RANGES,
	READABLE_EDGE,
	lightFalloff,
	readableFill,
	renderedLevels,
	renderedReach,
	LIGHT_KIND_DEFAULTS,
	LIGHT_KINDS,
	lightLevels,
	lightLook,
	lightSources,
	litMask,
	seenByLight,
	withDarkness,
	type Light
} from './lights';
import { blockingEdges, edgeKey, type Obstacles } from './objects';
import { cellIndex } from './visibility';

const grid: SquareGrid = { kind: 'square', cellSize: 1, width: 12, height: 12 };
const light = (x: number, y: number, radius: number, on = true): Light => ({
	id: `l${x}${y}`,
	pos: { x, y },
	radius,
	color: '#ffa04d',
	on
});
const wallX6 = blockingEdges([{ id: 'w', kind: 'wall', a: { x: 6, y: 0 }, b: { x: 6, y: 12 } }]);
const at = (x: number, y: number) => cellIndex(grid, { x, y });

describe('lightSources', () => {
	it('includes switched-on lights and tokens carrying light, nothing else', () => {
		const sources = lightSources(
			[light(1, 1, 3), light(2, 2, 3, false)],
			[
				{ pos: { x: 5, y: 5 }, light: 2 },
				{ pos: { x: 7, y: 7 }, light: 0 }
			]
		);
		expect(sources.map((s) => [s.pos.x, s.pos.y, s.radius])).toEqual([
			[1, 1, 3],
			[5, 5, 2]
		]);
	});

	it("gives a carried light its token's colour, else the carried-light default (#202)", () => {
		const [plain, tinted] = lightSources(
			[],
			[
				{ pos: { x: 1, y: 1 }, light: 2 },
				{ pos: { x: 2, y: 2 }, light: 2, lightColor: '#b8c8ff' }
			]
		);
		expect(CARRIED_LIGHT_COLOR).toBe('#ffa04d');
		expect(plain.color).toBe('#ffa04d');
		expect(tinted.color).toBe('#b8c8ff');
	});
});

describe('litMask / lightLevels', () => {
	it('lights a radius and stops at walls', () => {
		const mask = litMask(grid, wallX6, [light(4, 4, 4)]);
		expect(mask[at(4, 4)]).toBe(1);
		expect(mask[at(5, 4)]).toBe(1);
		expect(mask[at(6, 4)]).toBe(0);
		expect(mask[at(4, 9)]).toBe(0);
	});

	it('fades towards the edge and agrees with the lit mask', () => {
		const sources = [light(4, 4, 4), light(9, 9, 2)];
		const levels = lightLevels(grid, wallX6, sources);
		const mask = litMask(grid, wallX6, sources);
		expect(levels[at(4, 4)]).toBe(1);
		expect(levels[at(4, 7)]).toBeLessThan(levels[at(4, 5)]);
		for (let i = 0; i < mask.length; i++) expect(levels[i] > 0).toBe(mask[i] === 1);
	});
});

describe('dark areas', () => {
	const sources = lightSources([light(2, 2, 2)], []);

	it('marks and clears a dark area, and is null once nothing is dark', () => {
		const dark = withDarkness(null, grid, { x: 0, y: 0 }, { x: 5, y: 5 }, true);
		expect(dark?.[at(3, 3)]).toBe(1);
		expect(dark?.[at(8, 8)]).toBe(0);
		expect(withDarkness(dark, grid, { x: 5, y: 5 }, { x: 0, y: 0 }, false)).toBeNull();
	});

	it('lets anyone see only lit cells where it is dark, and everything elsewhere by day', () => {
		expect(seenByLight(grid, new Set(), 'day', null, sources)).toBeNull();
		const dark = withDarkness(null, grid, { x: 0, y: 0 }, { x: 5, y: 5 }, true);
		const seen = seenByLight(grid, new Set(), 'day', dark, sources)!;
		// Inside the dark area only the light's reach counts; outside it, everything is seen.
		expect(seen[at(2, 3)]).toBe(1);
		expect(seen[at(5, 5)]).toBe(0);
		expect(seen[at(9, 9)]).toBe(1);
		// After dark the whole table needs light, dark areas or not.
		const night = seenByLight(grid, new Set(), 'dark', null, sources)!;
		expect(night[at(9, 9)]).toBe(0);
		expect(night[at(2, 3)]).toBe(1);
	});
});

describe('light looks (#201)', () => {
	it('resolves a light without a kind to a torch, and a kind to its defaults', () => {
		expect(lightLook({})).toEqual(LIGHT_KIND_DEFAULTS.torch);
		expect(lightLook({ kind: 'glow' })).toMatchObject({ fixture: false, flicker: 'none' });
		expect(lightLook({ kind: 'candle', intensity: 2 })).toMatchObject({
			kind: 'candle',
			intensity: 2,
			height: 1
		});
		for (const kind of LIGHT_KINDS) expect(lightLook({ kind }).kind).toBe(kind);
	});

	it('changes nothing the rules see', () => {
		const plain = [light(4, 4, 4), light(9, 9, 2)];
		const dressed = plain.map((l): Light => ({
			...l,
			kind: 'neon',
			intensity: 3,
			height: 7,
			flicker: 'pulse',
			shadows: false,
			fixture: false,
			facing: 2
		}));
		const dark = withDarkness(null, grid, { x: 0, y: 0 }, { x: 11, y: 11 }, true);
		const rules = (lights: Light[]) => {
			const sources = lightSources(lights, []);
			return [
				litMask(grid, wallX6, sources),
				lightLevels(grid, wallX6, sources),
				seenByLight(grid, wallX6, 'dusk', dark, sources)
			];
		};
		expect(rules(dressed)).toEqual(rules(plain));
	});
});

describe('rendered falloff (#226)', () => {
	const big: SquareGrid = { kind: 'square', cellSize: 1, width: 24, height: 24 };
	const n = big.width * big.height;
	const idx = (x: number, y: number) => y * big.width + x;
	const area = (into: Uint8Array, x0: number, y0: number, x1: number, y1: number, v: number) => {
		for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) into[idx(x, y)] = v;
	};
	const vertical = (x: number, y0: number, y1: number) =>
		Array.from({ length: y1 - y0 }, (_, i) =>
			edgeKey({ a: { x, y: y0 + i }, b: { x, y: y0 + i + 1 } })
		);
	const horizontal = (y: number, x0: number, x1: number) =>
		Array.from({ length: x1 - x0 }, (_, i) =>
			edgeKey({ a: { x: x0 + i, y }, b: { x: x0 + i + 1, y } })
		);
	const obstacles = (edges: string[], levels: Uint8Array | null, windows: string[] = []) =>
		({
			edges: new Set(edges),
			width: big.width,
			solid: null,
			opaque: null,
			windows: new Set(windows),
			levels
		}) satisfies Obstacles;

	// A raised block whose rising ground hides the cells behind it.
	const raised = new Uint8Array(n);
	area(raised, 15, 8, 17, 16, 3);
	// A balcony at level 5 behind a see-through railing on one side and a wall on the other, like the
	// monastery's gallery.
	const balcony = new Uint8Array(n);
	area(balcony, 2, 2, 8, 8, 5);
	const scenarios = [
		{
			name: 'flat',
			blocked: obstacles([], null),
			at: [
				{ x: 12, y: 12 },
				{ x: 0, y: 0 }
			]
		},
		{
			name: 'a wall with a gap',
			blocked: obstacles([...vertical(14, 0, 10), ...vertical(14, 11, 24)], null),
			at: [{ x: 12, y: 12 }]
		},
		{
			name: 'raised ground',
			blocked: obstacles([], raised),
			at: [
				{ x: 12, y: 12 },
				{ x: 16, y: 12 }
			]
		},
		{
			name: 'a balcony behind a railing',
			blocked: obstacles(
				[...vertical(9, 2, 9), ...horizontal(9, 2, 9)],
				balcony,
				vertical(9, 2, 9)
			),
			at: [
				{ x: 6, y: 6 },
				{ x: 12, y: 12 }
			]
		},
		{
			name: 'a window',
			blocked: obstacles(horizontal(14, 0, 24), null, horizontal(14, 10, 14)),
			at: [{ x: 12, y: 12 }]
		}
	];
	const radii = Array.from({ length: 20 }, (_, i) => i + 1);

	it('renders above zero exactly on the cells the rules light, and readably on all of them', () => {
		let lit = 0;
		for (const { name, blocked, at } of scenarios) {
			for (const pos of at) {
				for (const radius of radii) {
					const sources = [{ pos, radius, color: '#ffa04d' }];
					const mask = litMask(big, blocked, sources);
					const rendered = renderedLevels(big, blocked, sources);
					const levels = lightLevels(big, blocked, sources);
					for (let i = 0; i < n; i++) {
						const shown = Math.max(rendered[i], readableFill(levels[i]));
						if (mask[i]) lit++;
						const agrees = rendered[i] > 0 === (mask[i] === 1);
						const readable = mask[i] ? shown >= READABLE_EDGE : shown === 0;
						if (!agrees || !readable) {
							expect.fail(`${name} at ${pos.x},${pos.y} r${radius} cell ${i}: ${shown}`);
						}
					}
				}
			}
		}
		expect(lit).toBeGreaterThan(0);
	});

	it('hides what the rules hide in each case', () => {
		const at = (s: (typeof scenarios)[number], x: number, y: number) =>
			renderedLevels(big, s.blocked, [{ pos: s.at[0], radius: 20, color: '#ffa04d' }])[idx(x, y)];
		expect(at(scenarios[1], 18, 20)).toBe(0); // behind the wall, off the gap's line
		expect(at(scenarios[2], 20, 12)).toBe(0); // behind the raised block
		expect(at(scenarios[4], 12, 16)).toBeGreaterThan(0); // through the window
		expect(at(scenarios[4], 4, 16)).toBe(0); // not through the wall beside it
		expect(at(scenarios[3], 12, 6)).toBeGreaterThan(0); // from the balcony, through its railing
		expect(at(scenarios[3], 5, 12)).toBe(0); // not through its wall
	});

	it('holds across the tunable ranges', () => {
		const corners = FALLOFF_RANGES.decay.flatMap((decay) =>
			FALLOFF_RANGES.coreRadius.flatMap((coreRadius) =>
				FALLOFF_RANGES.coreMax.map((coreMax) => ({ decay, coreRadius, coreMax }))
			)
		);
		const { blocked, at } = scenarios[4];
		for (const tune of corners) {
			for (const radius of [1, 7, 20]) {
				const sources = [{ pos: at[0], radius, color: '#ffa04d' }];
				const mask = litMask(big, blocked, sources);
				const rendered = renderedLevels(big, blocked, sources, tune);
				const levels = lightLevels(big, blocked, sources);
				for (let i = 0; i < n; i++) {
					const ok = FALLOFF_RANGES.readableEdge.every((edge) => {
						const shown = Math.max(rendered[i], readableFill(levels[i], edge));
						return rendered[i] > 0 === (mask[i] === 1) && (mask[i] ? shown >= edge : shown === 0);
					});
					if (!ok) expect.fail(`${JSON.stringify(tune)} r${radius} cell ${i}`);
				}
			}
		}
		const within = (v: number, [lo, hi]: readonly [number, number]) => v >= lo && v <= hi;
		expect(within(FALLOFF.decay, FALLOFF_RANGES.decay)).toBe(true);
		expect(within(FALLOFF.coreRadius, FALLOFF_RANGES.coreRadius)).toBe(true);
		expect(within(CORE_MAX, FALLOFF_RANGES.coreMax)).toBe(true);
		expect(within(READABLE_EDGE, FALLOFF_RANGES.readableEdge)).toBe(true);
	});

	it('ends its reach between the rules rim and the next cell', () => {
		for (const radius of radii) {
			const reach = renderedReach(radius);
			expect(radius * radius + radius).toBeLessThan(reach * reach);
			expect(radius * radius + radius + 1).toBeGreaterThan(reach * reach);
			expect(lightFalloff(radius, reach, reach)).toBe(0);
		}
	});

	it('never rises with distance and never passes the core cap', () => {
		for (const decay of FALLOFF_RANGES.decay) {
			for (const coreRadius of FALLOFF_RANGES.coreRadius) {
				for (const coreMax of FALLOFF_RANGES.coreMax) {
					const tune = { decay, coreRadius, coreMax };
					for (const radius of [1, 4, 20]) {
						for (const height of [0, 0.4, 1.6, 4]) {
							let last = Infinity;
							for (let dxz = 0; dxz <= renderedReach(radius) + 1; dxz += 0.05) {
								const f = lightFalloff(radius, dxz, Math.hypot(dxz, height), tune);
								if (f > coreMax || f > last) expect.fail(`${f} at ${dxz} after ${last}`);
								last = f;
							}
						}
					}
				}
			}
		}
		expect(lightFalloff(4, 0, 0)).toBe(CORE_MAX / FALLOFF.coreRadius ** FALLOFF.decay);
	});
});
