// Fog of war as atmosphere (#174): the pure halves of soft edges, reveal fades and the fog cloud.
// `worldModify` (materials/world-modify.ts) draws what `fogEdge` and `revealFog` say, from the
// cell maps (cell-maps.ts) and their uniforms; `RevealFades` is the client-side diff that feeds
// the fades, and `cloudDivisions`/`cloudMask` shape the cloud (fog-cloud.ts). Everything here is
// built from the viewer's own fog masks: no wire change, and nothing about a hidden cell's content.
//
// The rule every piece keeps: softening and fading only ever darken. A hidden cell's hard factor
// is 0, and the soft and faded factors are each at most the hard one, so its centre stays exactly
// black (#176), and the output stage's re-mask (`worldHidden`) follows the same soft factor.

/** How wide the soft band is, in the bilinear sample's 0-1 (0.5 is the line between cells). */
export const EDGE_BAND = 0.3;
/** How far low-frequency noise pushes the band inward, in the same units (never outward). */
export const EDGE_NOISE = 0.12;
/** The noise's frequency, per cell: about one bump every three cells, so edges read organic. */
export const EDGE_SCALE = 0.35;
/** How long a newly visible cell takes to fade in, in ms (#174: 300-600). */
export const FADE_MS = 450;

const smoothstep = (a: number, b: number, x: number) => {
	const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
	return t * t * (3 - 2 * t);
};

/**
 * A bilinear sample pulled toward the lower side of an edge, `noise` (-1 to 1) pushing the band
 * inward: 0 on the line between cells (0.5) whatever the noise, 1 at a known cell's centre.
 */
export const edgeShape = (smooth: number, noise: number) =>
	smoothstep(
		0.5,
		0.5 + EDGE_BAND,
		smooth - Math.min(1, Math.max(0, noise * 0.5 + 0.5)) * EDGE_NOISE
	);

/**
 * The fog factor with soft edges, the mirror of `worldModify`'s: the hard factor from the
 * cell's own state, and a soft one from the bilinear samples of visible and explored (`level`
 * gives the factor for a pair of 0-1 values), through `edgeShape` with the noise (-1 to 1).
 * The result is `min(hard, soft)`: it never exceeds the hard factor.
 */
export function fogEdge(
	hard: number,
	level: (visible: number, explored: number) => number,
	smooth: { visible: number; explored: number },
	noise: number
): number {
	const soft = level(edgeShape(smooth.visible, noise), edgeShape(smooth.explored, noise));
	return Math.min(hard, soft);
}

/**
 * A fading cell's factor, the mirror of the graph: from the factor of the state it came from to
 * its own, `remaining` (1 just revealed, 0 done) of the way back, and never above its own.
 */
export const revealFog = (now: number, from: number, remaining: number) =>
	Math.min(now, now + (from - now) * remaining);

/**
 * The client-side diff of the viewer's visible cells (#174): a cell that becomes visible fades in
 * over `FADE_MS` from what it was (hidden or explored); losing sight is immediate. `pack` writes
 * each cell's remaining fade (B, 255 just revealed, 0 done) and where it came from (A, 255
 * explored) into an RGBA8 map, the cell maps' `ground`. Fades run on the renderer's clock.
 */
export class RevealFades {
	private visible: Uint8Array | null = null;
	private explored: Uint8Array | null = null;
	/** The start time and whether it came from explored ground, by cell index. */
	private fading = new Map<number, { start: number; explored: boolean }>();
	/** Cells whose fade ended since the last `pack` (their bytes still to clear). */
	private ended: number[] = [];
	private fadeMs = FADE_MS;

	/** Under reduced motion reveals are instant: every fade ends now. */
	setReducedMotion(reduced: boolean): void {
		this.fadeMs = reduced ? 0 : FADE_MS;
		if (reduced) this.clear();
	}

	/**
	 * The viewer's new masks at time `now`, or null without fog (or on a new table, a new mode):
	 * with no masks before, nothing fades.
	 */
	update(visible: Uint8Array | null, explored: Uint8Array | null, now: number): void {
		const [was, known] = [this.visible, this.explored];
		[this.visible, this.explored] = [visible, explored];
		if (!visible || !was || was.length !== visible.length || this.fadeMs === 0) {
			this.clear();
			return;
		}
		for (let i = 0; i < visible.length; i++) {
			if (visible[i] && !was[i]) this.fading.set(i, { start: now, explored: !known || !!known[i] });
			else if (!visible[i] && this.fading.delete(i)) this.ended.push(i);
		}
	}

	/** Forgets the masks: the next update fades nothing. */
	reset(): void {
		this.visible = this.explored = null;
		this.clear();
	}

	/** Whether anything writes at `pack` (a fade under way, or one to clear). */
	get pending(): boolean {
		return this.fading.size > 0 || this.ended.length > 0;
	}

	/**
	 * Writes the fades at time `now` into B and A of an RGBA8 map; returns whether any is still
	 * under way (the renderer draws another frame).
	 */
	pack(data: Uint8Array, now: number): boolean {
		for (const i of this.ended) data[i * 4 + 2] = data[i * 4 + 3] = 0;
		this.ended = [];
		for (const [i, f] of this.fading) {
			const remaining = this.fadeMs > 0 ? 1 - (now - f.start) / this.fadeMs : 0;
			const byte = Math.round(255 * Math.min(1, Math.max(0, remaining)));
			data[i * 4 + 2] = byte;
			data[i * 4 + 3] = f.explored ? 255 : 0;
			if (byte === 0) this.fading.delete(i);
		}
		return this.fading.size > 0;
	}

	private clear(): void {
		for (const i of this.fading.keys()) this.ended.push(i);
		this.fading.clear();
	}
}

/** The cloud's most vertices (#174): 64k, a 64x64 table at three divisions a cell. */
export const CLOUD_VERTEX_CAP = 65_536;

/** Divisions per cell for the cloud's mesh: up to 4, within the vertex cap. */
export function cloudDivisions(width: number, height: number): number {
	for (let k = 4; k > 1; k--) if ((width * k + 1) * (height * k + 1) <= CLOUD_VERTEX_CAP) return k;
	return 1;
}

/**
 * How hidden the ground is at each of the cloud's vertices, (width x k + 1) x (height x k + 1)
 * in grid row order: 1 - explored, sampled bilinearly between cell centres (clamped at the
 * table's edge) as the visibility map is, so the cloud rises over hidden cells and meets explored
 * ground halfway across the edge.
 */
export function cloudMask(
	width: number,
	height: number,
	k: number,
	explored: ArrayLike<number>,
	out = new Float32Array((width * k + 1) * (height * k + 1))
): Float32Array {
	const hidden = (x: number, y: number) =>
		explored[Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))]
			? 0
			: 1;
	let o = 0;
	for (let vy = 0; vy <= height * k; vy++)
		for (let vx = 0; vx <= width * k; vx++) {
			const [gx, gy] = [vx / k - 0.5, vy / k - 0.5];
			const [x0, y0] = [Math.floor(gx), Math.floor(gy)];
			const [fx, fy] = [gx - x0, gy - y0];
			const top = hidden(x0, y0) * (1 - fx) + hidden(x0 + 1, y0) * fx;
			const bottom = hidden(x0, y0 + 1) * (1 - fx) + hidden(x0 + 1, y0 + 1) * fx;
			out[o++] = top * (1 - fy) + bottom * fy;
		}
	return out;
}
