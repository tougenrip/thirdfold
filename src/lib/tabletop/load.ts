// The renderer (and three.js with it) is the biggest part of the app, so it is
// its own chunk: loaded when a table is shown, or ahead of time (`prefetch`)
// while the visitor is still on the landing page or the join form.

let loading: Promise<typeof import('./renderer')> | null = null;

export function loadRenderer(): Promise<typeof import('./renderer')> {
	loading ??= import('./renderer').catch((err) => {
		// A failed download may succeed next time.
		loading = null;
		throw err;
	});
	return loading;
}

/** Starts downloading the renderer once the browser is idle; nothing happens if it is loaded. */
export function prefetchRenderer(): void {
	const start = () => void loadRenderer().catch(() => {});
	if (typeof requestIdleCallback === 'function') requestIdleCallback(start, { timeout: 3000 });
	else setTimeout(start, 500);
}
