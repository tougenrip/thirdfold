// Where the world changes a surface (#169): every kind ends in `worldModify`, and its emissive
// goes through `worldEmissive` first. Both are the identity until #171 fills them in with the
// cell maps: fog of war (hidden cells exactly black for players, explored dim), darkness by the
// rules' light level with the perception fill, the flash, emissive dimmed under fog (the
// emissive the MRT reads included), and the cut height's discard. Whatever they become, they
// read uniforms and always-bound textures only, so their graph never changes at runtime.

import type { N } from './tsl';

/** A surface's authored emissive as the world lets it glow. The identity until #171. */
export const worldEmissive = (emissive: N): N => emissive;

/**
 * A surface's lit colour (`output`, haze included) as the viewer sees it, given the emissive
 * already in it. The identity until #171.
 */
export const worldModify: (output: N, emissive: N) => N = (output) => output;
