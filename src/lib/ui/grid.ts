// How much grid shows (#245, after #167): the world's floors are not the grid,
// so the lines are an overlay shown as much as the moment needs. In full while
// the GM builds or anyone places a token or an enemy; faintly in the tactical
// view with nothing selected; otherwise (in play) round the hovered cell and
// the selected token. RoomView puts the Graphics menu's Grid setting on top
// (`withGridSetting`).

import type { GridMode } from '$lib/tabletop/grid-modes';
import type { CameraView } from '$lib/tabletop/types';

export interface GridMoment {
	isGm: boolean;
	/** The Build panel is open (only the GM's counts). */
	building: boolean;
	/** A build tool other than select is out (only the GM's counts). */
	tooling: boolean;
	/** A token is being placed. */
	placing: boolean;
	/** An enemy is being placed. */
	spawning: boolean;
	view: CameraView;
	/** A token is selected. */
	selected: boolean;
}

/** The grid's mode for the moment, before the viewer's Grid setting. */
export function gridModeOf(m: GridMoment): GridMode {
	if ((m.isGm && (m.building || m.tooling)) || m.placing || m.spawning) return 'build';
	return m.view === 'tactical' && !m.selected ? 'overview' : 'explore';
}
