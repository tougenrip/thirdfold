// Drop-in (#249): newly placed props, painted floors and raised cells fall into place over
// `DROP_MS` in the vertex stage (materials/drop.ts), like TaleSpire's tiles. Pure, so the server
// project tests it: what drops (`propsDropped`, `cellsDropped`), the curve the shader mirrors
// (`dropLeft`), and the clock (`Drops`): each instance or vertex carries the second its drop
// started, the GPU reads one uniform clock, and nothing moves on the CPU per frame.
//
// What drops is only what changed where the viewer already knew the ground: a new prop whose
// footprint was explored, a cell whose level or floor changed while explored. Exploring, a new
// table, a load or a reconnect (`Drops.hold`) and the first snapshot never drop anything.

import { footprintCells, type Prop } from '$lib/game/props';
import type { CellMask } from '$lib/game/visibility';

/** How long a drop takes. */
export const DROP_MS = 250;
/** How far above its place a piece starts, in cells. */
export const DROP_CELLS = 0.25;
/** The start of no drop: so long ago that every drop has ended. */
export const NO_DROP = -1e6;
/** The share of the drop spent falling; the rest is a small hop that settles. */
export const FALL = 0.75;
/** The hop's height, as a share of the drop. */
export const HOP = 0.06;

/**
 * How much of the drop is left at `t` (0 to 1 through it): a fall (eased in, as under gravity)
 * to the ground at `FALL`, then a hop of `HOP` that settles. Exactly 0 from 1 on, never below 0.
 * `dropNode` (materials/drop.ts) is the same in TSL.
 */
export function dropLeft(t: number): number {
	const c = Math.min(Math.max(t, 0), 1);
	const fall = Math.max(1 - (c / FALL) ** 2, 0);
	const s = Math.min(Math.max((c - FALL) / (1 - FALL), 0), 1);
	return fall + 4 * HOP * s * (1 - s);
}

/** Whether a cell was known (`known` null: everything is, the GM's or a table without fog). */
const knows = (known: CellMask | null, i: number) => !known || known[i] !== 0;

/** What a viewer had of the ground: as `WorldShape` holds it (levels and floors, continued). */
export interface GroundState {
	width: number;
	height: number;
	known: CellMask | null;
	levels: Uint8Array;
	floor: Uint8Array;
}

/** The cells whose level or floor changed while known before and after: they drop. */
export function cellsDropped(before: GroundState, after: GroundState): number[] {
	if (before.width !== after.width || before.height !== after.height) return [];
	const out: number[] = [];
	for (let i = 0; i < after.width * after.height; i++)
		if (
			knows(before.known, i) &&
			knows(after.known, i) &&
			(before.levels[i] !== after.levels[i] || before.floor[i] !== after.floor[i])
		)
			out.push(i);
	return out;
}

/** The props new since `before` whose whole footprint the viewer knew then: they drop. */
export function propsDropped(
	before: { props: readonly Prop[]; known: CellMask | null },
	props: readonly Prop[],
	width: number
): string[] {
	const had = new Set(before.props.map((p) => p.id));
	return props
		.filter(
			(p) =>
				!had.has(p.id) && footprintCells(p).every((c) => knows(before.known, c.y * width + c.x))
		)
		.map((p) => p.id);
}

/**
 * The drops' clock, one per renderer. `start` gives a new drop's start (seconds since the clock
 * was made, so float32 keeps milliseconds over a long session), or `NO_DROP` under reduced
 * motion or while held; `tick` runs every drawn frame, setting the shaders' clock (`now`, the
 * `dropNow` uniform) and saying whether a drop still plays (the scheduler draws actively until
 * the last ends, then the table goes idle). `frame` counts drawn frames: the layers compare what
 * changed against what the last frame drew, so updates that come together (a fog diff with the
 * floors it reveals) count as one.
 */
export class Drops {
	reduced = false;
	/** Drawn frames so far. */
	frame = 0;
	/** Whether a drop played at the last frame. */
	active = false;
	private until = -Infinity;
	private quiet = -1;
	private readonly epoch: number;

	constructor(
		private readonly clock: () => number,
		private readonly now: { value: number } = { value: 0 }
	) {
		this.epoch = clock();
	}

	/** A drop starting now: its start in seconds, or `NO_DROP`. */
	start(): number {
		if (this.reduced || this.frame === this.quiet) return NO_DROP;
		const now = this.clock();
		this.until = Math.max(this.until, now + DROP_MS);
		return (now - this.epoch) / 1000;
	}

	/** Nothing drops until the next frame: a load, a reconnect, a new snapshot of the table. */
	hold(): void {
		this.quiet = this.frame;
	}

	/** A frame at `now` (ms, the renderer's clock): true while a drop plays. */
	tick(now: number): boolean {
		this.frame++;
		this.now.value = (now - this.epoch) / 1000;
		return (this.active = now < this.until);
	}
}

/** A viewer's props and explored cells (null: all), as a frame showed them. */
interface PropsSeen {
	props: readonly Prop[];
	known: CellMask | null;
}

/** Which of a `PropLayer`'s props drop, and since when. */
export class PropDrops {
	private starts = new Map<string, number>();
	private now: PropsSeen = { props: [], known: null };
	private seen: PropsSeen & { frame: number } = { ...this.now, frame: -1 };

	constructor(readonly drops: Drops) {}

	/**
	 * The props the layer now draws; `fresh`: a new table, where nothing drops until its first
	 * frame (the ground's first updates come after the grid's in the same flush).
	 */
	update(props: readonly Prop[], width: number, known: CellMask | null, fresh: boolean): void {
		if (fresh) this.drops.hold();
		if (this.seen.frame !== this.drops.frame) this.seen = { ...this.now, frame: this.drops.frame };
		this.now = { props, known };
		const dropped = fresh ? [] : propsDropped(this.seen, props, width);
		const fresher = dropped.filter((id) => !this.starts.has(id));
		if (fresher.length === 0) return;
		const start = this.drops.start();
		if (start === NO_DROP) return;
		for (const [id, at] of this.starts) if (at < start - 1) this.starts.delete(id); // long over
		for (const id of fresher) this.starts.set(id, start);
	}

	/** When a prop's drop started (`NO_DROP` if it never did). */
	startOf(id: string): number {
		return this.starts.get(id) ?? NO_DROP;
	}
}
