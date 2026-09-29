// Stable micro-offsets against z-fighting (#181), free of three so the server project tests them.
// Props and decals that lie on a floor or on each other (the Hollow's water sheets, rugs, the
// finale's cracks) are coplanar with it, so the depth test flickers between them. Each instance
// is lifted along its normal by a hash of its asset and anchor cell, in [0, 1) of the kind's
// `params.lift` (a thousandth of a cell): the same on every client, every load and both
// backends, since it is worked out here and handed to the GPU as a number, and never negative,
// so anything placed on the table or raised ground (lifted 0) sits above it. Exact duplicates
// (same asset, same cell) get the same lift, but they are identical, so nothing flickers.

/** FNV-1a, 32-bit, of a string's UTF-16 code units (asset ids are ASCII). */
export function fnv1a(text: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
	return h >>> 0;
}

/**
 * The PCG hash of a 32-bit seed, in [0, 1): the same arithmetic as three's TSL `hash`
 * (nodes/math/Hash.js, from pcg-random.org), so a shader could reproduce it.
 */
export function pcgHash(seed: number): number {
	const state = (Math.imul(seed >>> 0, 747796405) + 2891336453) >>> 0;
	const word = Math.imul(((state >>> ((state >>> 28) + 4)) ^ state) >>> 0, 277803737) >>> 0;
	return (((word >>> 22) ^ word) >>> 0) / 2 ** 32;
}

/** The seed of an asset at a cell: its id's FNV-1a mixed with the cell (Teschner's primes). */
export const liftSeed = (assetId: string, cell: { x: number; y: number }): number =>
	(fnv1a(assetId) ^ Math.imul(cell.x, 73856093) ^ Math.imul(cell.y, 19349663)) >>> 0;

/** How far an instance of `assetId` anchored at `cell` is lifted, in [0, 1) of `params.lift`. */
export const liftOf = (assetId: string, cell: { x: number; y: number }): number =>
	pcgHash(liftSeed(assetId, cell));
