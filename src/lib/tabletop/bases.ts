// Token bases (#265), the pure part: the base's profile, the ring palette and which ring a token
// wears, and how bright it glows. Server-tested (bases.spec.ts); the instanced mesh that draws
// them is base-layer.ts, its shader materials/base.ts.
//
// A ring's colour says whose mini it is, from only what the viewer was sent: a player's tokens
// take their seat's colour (the owner's place among the players, in join order, the same for
// every viewer), enemies in the fight at hand are red, everything else (NPCs, the GM's tokens,
// sentries outside a fight) neutral. Colour is never the only cue: enemies have a notched rim and
// the viewer's own tokens a double ring.

import type { Token } from '../game/token';
import type { PublicPlayer } from '../game/protocol';

/**
 * The base's profile from the foot of its edge up and in to its centre: (radius, height) in cell
 * units, 0.86 across and 0.1 tall. Lathed (`LatheGeometry`, whose uv.y is a point's index over the
 * last, and whose faces look the way the profile turns: up and out in this order), so each band
 * is a range of uv.y the shader reads (`BANDS`).
 */
export const BASE_PROFILE: readonly (readonly [number, number])[] = [
	[0.43, 0], // the edge
	[0.43, 0.07], // a 45° bevel
	[0.4, 0.1], // the lip
	[0.365, 0.1],
	[0.355, 0.088], // the ring, set a little in
	[0.31, 0.088],
	[0.3, 0.092], // the inner disc: the environment's surface
	[0, 0.092]
];

const last = BASE_PROFILE.length - 1;
/**
 * The bands as uv.y ranges: the rim (edge, bevel and the lip's top) below `rim`, the ring between
 * `ring`'s two, the disc above `disc`.
 */
export const BANDS = { rim: 3 / last, ring: [4 / last, 5 / last], disc: 5 / last } as const;

/** Notches round an enemy's rim. */
export const NOTCHES = 8;

/**
 * The ring colours, 0xrrggbb sRGB: six seats (Okabe and Ito's palette: orange, sky blue, bluish
 * green, yellow, blue, reddish purple), then the enemy's red and the neutral off-white. Seats past six
 * repeat (hover shows the name).
 */
export const BASE_PALETTE = [
	0xe69f00, 0x56b4e9, 0x009e73, 0xf0e442, 0x0072b2, 0xcc79a7, 0xe0312a, 0xe0dcd4
] as const;
export const SEATS = 6;
export const ENEMY = 6;
export const NEUTRAL = 7;

/** The ring a token wears: a `BASE_PALETTE` index, and its shape twins. */
export interface Ring {
	colour: number;
	/** An enemy's: the rim notched. */
	notched: boolean;
	/** The viewer's own: two thin rings instead of one. */
	double: boolean;
}

export const NEUTRAL_RING: Ring = { colour: NEUTRAL, notched: false, double: false };

/** What a viewer was sent that rings read. */
export interface RingContext {
	players: readonly Pick<PublicPlayer, 'id' | 'role'>[];
	/** The viewer's player id, or null. */
	viewer: string | null;
	/** The tokens of enemies in the fight at hand. */
	enemies: ReadonlySet<string>;
}

/** The ring `token` wears for a viewer. */
export function ringFor(token: Pick<Token, 'id' | 'ownerId'>, ctx: RingContext): Ring {
	if (ctx.enemies.has(token.id)) return { colour: ENEMY, notched: true, double: false };
	const seat = ctx.players
		.filter((p) => p.role === 'player')
		.findIndex((p) => p.id === token.ownerId);
	if (seat < 0) return NEUTRAL_RING;
	return { colour: seat % SEATS, notched: false, double: token.ownerId === ctx.viewer };
}

/** Every token's ring, by id. */
export function ringsFor(
	tokens: readonly Pick<Token, 'id' | 'ownerId'>[],
	ctx: RingContext
): Map<string, Ring> {
	return new Map(tokens.map((t) => [t.id, ringFor(t, ctx)]));
}

/** The ring's emission at rest, hovered and selected; an active turn pulses between `PULSE`. */
export const EMISSION = { rest: 0.26, hovered: 1, selected: 1.6 } as const;
export const PULSE = { low: 1, high: 1.6, hz: 0.75 } as const;

/**
 * How brightly a ring glows at `now` (ms): the brightest of its states. The active token's pulses
 * at `PULSE.hz` (under three changes a second, WCAG 2.3.1), steady at its middle when `still`
 * (reduced motion).
 */
export function ringEmission(
	state: { hovered: boolean; selected: boolean; active: boolean },
	now: number,
	still: boolean
): number {
	let e: number = EMISSION.rest;
	if (state.hovered) e = Math.max(e, EMISSION.hovered);
	if (state.selected) e = Math.max(e, EMISSION.selected);
	if (state.active) {
		const k = still ? 0.5 : 0.5 - 0.5 * Math.cos((2 * Math.PI * PULSE.hz * now) / 1000);
		e = Math.max(e, PULSE.low + (PULSE.high - PULSE.low) * k);
	}
	return e;
}

/**
 * Base diameters (#270), cell units: Small and Medium, Large, Huge, Gargantuan (D&D's 1, 2, 3 and
 * 4 inches, a cell 1 inch less its gap). A large creature is visual scale on one cell; the rules
 * footprint stays one cell (multi-cell rules sizes are #96's, which will then pick the base).
 */
export const BASE_SIZES = [0.86, 1.9, 2.9, 3.9] as const;
export const SMALL_BASE: number = BASE_SIZES[0];

/** The base under a mini of `scale` (`Token.scale`). */
export function baseSizeFor(scale = 1): number {
	if (scale < 1.5) return BASE_SIZES[0];
	if (scale < 2.5) return BASE_SIZES[1];
	if (scale < 3.5) return BASE_SIZES[2];
	return BASE_SIZES[3];
}

/**
 * The drawn diameter of every token's base, by id: its `baseSizeFor`, except that a large base
 * shrinks to `SMALL_BASE` when any other token's base (at its own size) would overlap it, the
 * centres nearer than the two radii and the floors within one level (`level`). Reads only the
 * tokens given, which must be what this viewer was sent, so a token hidden from a player never
 * shrinks a base in that player's picture. O(n²) over large tokens only.
 */
export function baseDiameters(
	tokens: readonly Pick<Token, 'id' | 'pos' | 'scale'>[],
	level: (pos: Token['pos']) => number = () => 0
): Map<string, number> {
	const sizes = tokens.map((t) => baseSizeFor(t.scale));
	const out = new Map<string, number>();
	tokens.forEach((t, i) => {
		const own = sizes[i];
		const covers = (o: (typeof tokens)[number], k: number) =>
			k !== i &&
			Math.hypot(o.pos.x - t.pos.x, o.pos.y - t.pos.y) < (own + sizes[k]) / 2 &&
			Math.abs(level(o.pos) - level(t.pos)) <= 1;
		out.set(t.id, own > SMALL_BASE && tokens.some(covers) ? SMALL_BASE : own);
	});
	return out;
}

/**
 * The profile for a base `diameter` across: the edge, bevel, lip and ring keep their widths and
 * the inner disc takes up the rest, so a large base reads as the same base, only wider.
 */
export function profileFor(diameter: number): (readonly [number, number])[] {
	const grow = (diameter - SMALL_BASE) / 2;
	return BASE_PROFILE.map(([r, y]) => [r === 0 ? 0 : r + grow, y] as const);
}

/** The radius of a base's centre disc that picks its token (#270): a small base's, any size. */
export const PICK_RADIUS = SMALL_BASE / 2;
