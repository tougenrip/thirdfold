// Frames on demand: nothing is drawn until something asks for a frame, and
// at most one is ever waiting. Flickering flames and drifting mist ask on a
// slow timer instead (AMBIENT_FRAME_MS), never every frame.

/** How often ambient animation redraws, in ms. */
export const AMBIENT_FRAME_MS = 80;

export class FrameLoop {
	private frame = 0;
	private ambientTimer: ReturnType<typeof setTimeout> | 0 = 0;

	constructor(private readonly draw: () => void) {}

	/** Draws on the next animation frame (once, however often it is asked). */
	request = (): void => {
		if (!this.frame) {
			this.frame = requestAnimationFrame(() => {
				this.frame = 0;
				this.draw();
			});
		}
	};

	/** Draws again after AMBIENT_FRAME_MS, for slow ambient animation. */
	ambient(): void {
		if (this.ambientTimer) return;
		this.ambientTimer = setTimeout(() => {
			this.ambientTimer = 0;
			this.request();
		}, AMBIENT_FRAME_MS);
	}

	dispose(): void {
		cancelAnimationFrame(this.frame);
		if (this.ambientTimer) clearTimeout(this.ambientTimer);
	}
}

/**
 * Follows `prefers-reduced-motion` live, so turning it on or off applies at
 * once; `override` (tests) wins when set. Returns the current value and a
 * function that stops listening.
 */
export function watchReducedMotion(
	override: boolean | undefined,
	onChange: (reduced: boolean) => void
): { reduced: boolean; stop: () => void } {
	const query =
		typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
	const listener = (e: MediaQueryListEvent) => {
		if (override === undefined) onChange(e.matches);
	};
	query?.addEventListener('change', listener);
	return {
		reduced: override ?? query?.matches ?? false,
		stop: () => query?.removeEventListener('change', listener)
	};
}
