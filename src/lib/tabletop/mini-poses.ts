// Static poses for minis (#273): a figure's model may carry `body_pose1` to `body_pose3`, sculpts
// drawn instead of its body, and its manifest entry says what each is for (`ModelEntry.poses`).
// The state comes only from what this viewer was sent: a character down or dead in its adventure
// view, the token whose turn it is. No skinning, no animation: a pose change moves the figure to
// another batch (figures.ts).

import type { ModelPoses } from '$lib/assets/manifest';

export interface PoseState {
	/** A character downed or dead. */
	downed: boolean;
	/** The token whose turn it is in a fight. */
	active: boolean;
}

/** The pose to show (0: the plain body): downed before active, and only poses the model has. */
export function poseOf(state: PoseState, poses: ModelPoses | undefined): number {
	if (state.downed && poses?.downed) return poses.downed;
	if (state.active && poses?.active) return poses.active;
	return 0;
}
