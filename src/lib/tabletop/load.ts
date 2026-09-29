// The renderer (and three.js with it) is the biggest part of the app, so it is
// its own chunk: loaded when a table is shown, or ahead of time (`prefetch`)
// while the visitor is still on the landing page or the join form, where the
// renderer the table will use is made and its shaders compiled too (lobby.ts, #180).

import type { WarmRenderer } from './lobby';

let loading: Promise<typeof import('./renderer')> | null = null;
let warming: Promise<WarmRenderer | null> | null = null;

export function loadRenderer(): Promise<typeof import('./renderer')> {
	loading ??= import('./renderer').catch((err) => {
		// A failed download may succeed next time.
		loading = null;
		throw err;
	});
	return loading;
}

/**
 * Starts downloading the renderer once the browser is idle, then warms it up for the first
 * table; nothing happens if that is under way or done.
 */
export function prefetchRenderer(): void {
	const start = () => void warmRenderer();
	if (typeof requestIdleCallback === 'function') requestIdleCallback(start, { timeout: 3000 });
	else setTimeout(start, 500);
}

/** Makes and warms up the renderer the first table adopts (lobby.ts); null where it can't. */
export function warmRenderer(): Promise<WarmRenderer | null> {
	warming ??= loadRenderer()
		.then(({ warmLobby }) => warmLobby())
		.catch(() => null);
	return warming;
}

/**
 * The lobby's renderer, once (a warm-up under way is waited for): the table that takes it owns
 * it. Null when there is none.
 */
export async function takeWarmRenderer(): Promise<WarmRenderer | null> {
	const warm = warming;
	warming = null;
	return warm ? await warm : null;
}
