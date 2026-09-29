// When the grid lines show (#167): the world's floors are not the grid, so the
// lines are an overlay for the moments the grid matters, never at rest. A
// selected token alone doesn't count: a player's character stays selected in an
// adventure, which would keep the lines on all the time.

export interface GridMoment {
	isGm: boolean;
	/** The Build panel is open (only the GM's counts). */
	building: boolean;
	/** A token is being placed. */
	placing: boolean;
	/** An enemy is being placed. */
	spawning: boolean;
	/** A cell is highlighted: a move being aimed, or where a token would go. */
	aiming: boolean;
}

/** Whether the grid lines show ('Always show grid' is added by the Tabletop). */
export function gridShown(m: GridMoment): boolean {
	return (m.isGm && m.building) || m.placing || m.spawning || m.aiming;
}
