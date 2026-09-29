// The render scheduler (#148): when a frame is drawn, in four modes. IDLE
// draws nothing until something changes. ACTIVE draws while something moves
// (tokens, doors, dice, props, cues, shots, the camera), at most at the tier's
// frame rate, so a 144 Hz screen still draws 60. AMBIENT redraws flickering
// flames and drifting mist on a slow clock, and not at all while the table
// can't be seen, motion is reduced or power is being saved. CONVERGE draws a
// few settle frames after movement ends (TRAA's, from #163; none until then).
//
// The policy (`modeFor`, `frameInterval`) is pure and tested in
// scheduler.spec.ts; `RenderScheduler` drives it with requestAnimationFrame.
// Layers report what they did in a frame (`FrameReport`); the frame's code
// asks them. Animation runs on the injected clock, never on frame counts, so
// browsers that throttle frames change how smooth it is, not how long.

export type Mode = 'idle' | 'ambient' | 'active' | 'converge';

export interface Situation {
	/** Something moved in the last frame, or a change is waiting to be drawn. */
	active: boolean;
	/** A visible layer animates slowly (flicker, mist). */
	ambient: boolean;
	/** Settle frames still owed after movement ended. */
	converging: number;
	/** The tab is hidden, or the canvas scrolled out of view. */
	hidden: boolean;
	reducedMotion: boolean;
	powerSaver: boolean;
}

/** The tier's pacing (quality.ts). */
export interface Pacing {
	fpsCap: number;
	ambientFps: number;
	convergeFrames: number;
}

/** How often flicker and mist redraw (12.5 fps), and after a minute without input (10 fps). */
export const AMBIENT_MS = 80;
export const SLOW_AMBIENT_MS = 100;
export const SLOW_AFTER_MS = 60_000;

export function modeFor(s: Situation): Mode {
	if (s.active) return 'active';
	if (s.hidden) return 'idle';
	if (s.converging > 0) return 'converge';
	if (s.ambient && !s.reducedMotion && !s.powerSaver) return 'ambient';
	return 'idle';
}

/** The least time between two frames in a mode, in ms (null: none are drawn). */
export function frameInterval(mode: Mode, pacing: Pacing, idleForMs: number): number | null {
	switch (mode) {
		case 'active':
		case 'converge':
			return 1000 / pacing.fpsCap;
		case 'ambient':
			return Math.max(
				idleForMs >= SLOW_AFTER_MS ? SLOW_AMBIENT_MS : AMBIENT_MS,
				1000 / pacing.ambientFps
			);
		case 'idle':
			return null;
	}
}

/**
 * Whether a frame is due at `now`, `last` being when the last was drawn: a
 * callback that comes early (a fast screen) is skipped. A millisecond of slack
 * keeps a 60 Hz screen from skipping every other frame over timer jitter.
 */
export function frameDue(now: number, last: number, interval: number | null): boolean {
	return interval !== null && now - last >= interval - 1;
}

/** What a drawn frame reports: anything still moving, anything animating slowly. */
export interface FrameReport {
	active: boolean;
	ambient: boolean;
}

export class RenderScheduler {
	private frame = 0;
	private timer: ReturnType<typeof setTimeout> | 0 = 0;
	/** A warm-up is compiling: frames wait (the canvas keeps its last one). */
	private held = false;
	private wanted = false;
	private last = -Infinity;
	private report: FrameReport = { active: false, ambient: false };
	private converging = 0;
	private lastInput = performance.now();
	private pacing: Pacing = { fpsCap: 60, ambientFps: 30, convergeFrames: 0 };
	private reducedMotion = false;
	private powerSaver = false;
	/** A change was asked for since the last frame. */
	private changed = false;
	private tabHidden = typeof document !== 'undefined' && document.hidden;
	private offscreen = false;
	private readonly observer: IntersectionObserver | null;
	private readonly stopWatching: () => void;

	/** `draw` draws a frame and reports on it; `canvas` is watched for being out of view. */
	constructor(
		private readonly draw: () => FrameReport,
		canvas: HTMLCanvasElement | null = null
	) {
		const onVisibility = () => {
			this.tabHidden = document.hidden;
			this.plan();
		};
		const onInput = () => (this.lastInput = performance.now());
		document.addEventListener('visibilitychange', onVisibility);
		for (const type of ['pointerdown', 'keydown', 'wheel'] as const)
			window.addEventListener(type, onInput, { passive: true });
		this.observer =
			canvas && typeof IntersectionObserver === 'function'
				? new IntersectionObserver(([e]) => {
						this.offscreen = !e.isIntersecting;
						this.plan();
					})
				: null;
		if (canvas) this.observer?.observe(canvas);
		this.stopWatching = () => {
			document.removeEventListener('visibilitychange', onVisibility);
			for (const type of ['pointerdown', 'keydown', 'wheel'] as const)
				window.removeEventListener(type, onInput);
			this.observer?.disconnect();
		};
	}

	get mode(): Mode {
		// A frame on its way: converging once nothing moves any more, else active.
		if (this.frame && !this.timer)
			return !this.report.active && this.converging > 0 ? 'converge' : 'active';
		return modeFor(this.situation(false));
	}

	get holding(): boolean {
		return this.held;
	}

	setPacing(pacing: Pacing): void {
		this.pacing = pacing;
	}

	setReducedMotion(reduced: boolean): void {
		this.reducedMotion = reduced;
		this.plan();
	}

	setPowerSaver(on: boolean): void {
		this.powerSaver = on;
		this.plan();
	}

	/** Holds frames until `work` settles, then draws once if anything asked meanwhile. */
	hold(work: Promise<unknown>): void {
		this.held = true;
		void work.finally(() => {
			this.held = false;
			if (this.wanted) {
				this.wanted = false;
				this.request();
			}
		});
	}

	/**
	 * Something changed: draw it (once, however often it is asked), within the frame-rate cap. A
	 * change restarts CONVERGE (TRAA's history needs its frames); the scheduler's own frames don't.
	 */
	request = (): void => {
		this.changed = true;
		this.schedule();
	};

	/** Asks for a frame without counting it as a change. */
	private schedule(): void {
		if (this.held) {
			this.wanted = true;
			return;
		}
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = 0;
		}
		if (!this.frame) this.frame = requestAnimationFrame((now) => this.onFrame(now));
	}

	private onFrame(now: number): void {
		this.frame = 0;
		// A callback earlier than the cap allows (a fast screen) waits for the next one.
		if (!frameDue(now, this.last, 1000 / this.pacing.fpsCap)) {
			this.frame = requestAnimationFrame((t) => this.onFrame(t));
			return;
		}
		this.last = now;
		const wasActive = this.report.active;
		const changed = this.changed;
		this.changed = false;
		this.report = this.draw();
		// Power saver converges in half the frames.
		const converge = Math.ceil(this.pacing.convergeFrames / (this.powerSaver ? 2 : 1));
		if (this.report.active || wasActive || changed) this.converging = converge;
		else if (this.converging > 0) this.converging--;
		this.plan();
	}

	private situation(active: boolean): Situation {
		return {
			active,
			ambient: this.report.ambient,
			converging: this.converging,
			hidden: this.tabHidden || this.offscreen,
			reducedMotion: this.reducedMotion,
			powerSaver: this.powerSaver
		};
	}

	/** Schedules the next frame for the mode the last one left things in. */
	private plan(): void {
		if (this.held || this.frame) return;
		const mode = modeFor(this.situation(this.report.active));
		if (mode === 'active' || mode === 'converge') return this.schedule();
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = 0;
		}
		const interval = frameInterval(mode, this.pacing, performance.now() - this.lastInput);
		if (interval === null) return;
		this.timer = setTimeout(() => {
			this.timer = 0;
			this.schedule();
		}, interval);
	}

	dispose(): void {
		cancelAnimationFrame(this.frame);
		if (this.timer) clearTimeout(this.timer);
		this.stopWatching();
	}
}
