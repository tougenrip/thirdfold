// The drop-in's vertex node (#249, drop-in.ts): a piece lifted by what is left of its drop, read
// from its start (`DROP_ATTRIBUTE`, per instance on props, per vertex on the world's chunks) and
// one clock (`dropNow`), so nothing moves on the CPU. All ALU on an attribute and two uniforms:
// a drop starting, ending or under reduced motion (a start long past) compiles nothing.

import { uniform } from 'three/tsl';
import { DROP_MS, FALL, HOP } from '../drop-in';
import { tsl, type N } from './tsl';

/** A piece's drop start, in seconds on the drops' clock (`NO_DROP` for none). */
export const DROP_ATTRIBUTE = 'aDrop';

/** The drops' clock in seconds (`Drops.tick` sets it every drawn frame). */
export const dropNow = uniform(0);

/** How high a drop starts, in world units (`DROP_CELLS` of a cell; the layers set it). */
export const dropHeight = uniform(0);

/** The lift of a piece whose drop started at `start`: up, by `dropLeft` of its progress. */
export function dropLift(start: N = tsl.attribute(DROP_ATTRIBUTE, 'float')): N {
	const now = dropNow as unknown as N;
	const t = now
		.sub(start)
		.div(DROP_MS / 1000)
		.saturate();
	const fall = tsl.max(t.div(FALL).pow(2).oneMinus(), 0);
	const s = t
		.sub(FALL)
		.div(1 - FALL)
		.saturate();
	const left = fall.add(s.mul(s.oneMinus()).mul(4 * HOP));
	return tsl.vec3(0, left.mul(dropHeight as unknown as N), 0);
}
