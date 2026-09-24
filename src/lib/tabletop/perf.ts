// What the renderer costs, measured as it runs: how many frames it drew and
// how long each took, and how long each kind of update (a new table, tokens
// moving, light) took on the main thread. Cheap enough to leave on: a few
// performance.now() calls per frame or update. Read by the perf overlay
// (`?perf` in the URL) and by the measurements in docs/PERFORMANCE.md.

/** Running totals for one kind of work. */
export interface Timing {
	count: number;
	/** Total milliseconds. */
	total: number;
	/** The slowest one, in milliseconds. */
	max: number;
	/** The most recent one, in milliseconds. */
	last: number;
}

export interface PerfStats {
	/** Frames drawn since the renderer started. */
	frames: number;
	/** Frames drawn in the last second. */
	fps: number;
	/** Main-thread time of a frame (the scene updated and drawn), by kind of work. */
	timings: Record<string, Timing>;
	/** From three.js: what the last frame drew, and what lives on the GPU. */
	drawCalls: number;
	triangles: number;
	geometries: number;
	textures: number;
	programs: number;
}

export class PerfRecorder {
	frames = 0;
	private readonly timings = new Map<string, Timing>();
	/** Times of the frames drawn in the last second. */
	private readonly recent: number[] = [];

	/** Runs `fn`, adding its duration to `label`. */
	time<T>(label: string, fn: () => T): T {
		const start = performance.now();
		try {
			return fn();
		} finally {
			this.add(label, performance.now() - start);
		}
	}

	add(label: string, ms: number): void {
		const t = this.timings.get(label) ?? { count: 0, total: 0, max: 0, last: 0 };
		t.count++;
		t.total += ms;
		t.max = Math.max(t.max, ms);
		t.last = ms;
		this.timings.set(label, t);
	}

	frame(now: number): void {
		this.frames++;
		this.recent.push(now);
		while (this.recent.length && this.recent[0] < now - 1000) this.recent.shift();
	}

	/** Frames in the second up to `now`. */
	fps(now: number): number {
		return this.recent.filter((t) => t >= now - 1000).length;
	}

	snapshot(now: number): Pick<PerfStats, 'frames' | 'fps' | 'timings'> {
		return {
			frames: this.frames,
			fps: this.fps(now),
			timings: Object.fromEntries([...this.timings].map(([k, v]) => [k, { ...v }]))
		};
	}

	reset(): void {
		this.frames = 0;
		this.timings.clear();
		this.recent.length = 0;
	}
}
