// The renderer (and three.js with it) is the biggest part of the app, so it is
// its own chunk: loaded when a table is shown, or ahead of time (`prefetch`)
// while the visitor is still on the landing page or the join form, where the
// renderer the table will use is made and its shaders compiled too (lobby.ts, #180).

import type { WarmRenderer } from './lobby';

let loading: Promise<typeof import('./renderer')> | null = null;
let warming: Promise<WarmRenderer | null> | null = null;
/**
 * A table took the warm-up (or found none) since the last prefetch: a prefetch still waiting for
 * idle time then only loads the chunk, or it would make a second renderer nobody adopts, warming
 * beside the table's (the room page prefetches, then shows a resumed seat's table at once).
 */
let taken = false;

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
	taken = false;
	const start = () => void (taken ? loadRenderer().catch(() => {}) : warmRenderer());
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
	taken = true;
	return warm ? await warm : null;
}
