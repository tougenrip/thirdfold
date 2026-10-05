// The world's builders (M69): a lazy chunk of their own (`world` in
// scripts/check-bundle.mjs), so the renderer chunk stops growing with them.
// Everything the ground's chunks are built from goes through here: the shape,
// its dual cases and regions, the ground's emitter, and the builders to come
// (the cliffs, #241; beyond, #244; the void's chasms, #243; splats): export each from this file and only
// `import type` it elsewhere in the renderer, or it is pulled back into the
// renderer chunk. world-layer.ts `loadWorld` fetches it; `createTabletop`
// awaits it beside the node renderer, and load.ts starts it with the renderer's
// prefetch, so a table never waits on it. What a frame needs at once stays
// out: the DDA's picks (pick.ts) and the wall spans (wall-spans.ts).

export { CHUNK, chunksAcross, dirtyChunks, EDGE_BUILT, knownOf, worldShape } from './shape';
export { chunkGround } from './ground-mesh';
export { regionsOf } from './regions';
export { beyondHeightAt, beyondOf, beyondSample, ridgeMesh, skirtMesh } from './beyond';
export { chunkWorld, CLIFF_STYLES, styleOf } from './cliffs';
export { chasmGround, chasmOf, DEFAULT_CHASM, mistTexels } from './chasm';
export { autotile, dirtyPieceChunks, keySeed, tileInput, variantOf } from './autotile';
export {
	BATCH_ROLES,
	edgeIndex,
	pieceOf,
	proceduralPiece,
	roleOfKey,
	VARIANTS,
	wallInstances
} from './wall-batch';
export { brinkCells, chunkTiles, dirtyTileChunks, tileBeds, tiledCells } from './floor-tiles';
export { builtGround, stairDirty, stairTrim, withStairs, withTrim } from './stairs';
