// Fog of war in the three.js view. Presentation only: the server already
// withholds hidden tokens and walls from players; the picture matches it on
// every surface. The fog itself is the cell maps' `visibility` map (R visible,
// G explored, cell-maps.ts), which every material's `worldModify` reads: a
// player's hidden cells exactly black, explored ones dim, desaturated and cool,
// the GM's a light tint where the party can't see. The plane that darkened only
// the floor went in #173; `FogMode` is what the renderer passes on for it.

/** Players see darkness; the GM sees a light tint marking what the party cannot see. */
export type FogMode = 'player' | 'gm';
