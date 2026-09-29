// The lobby's renderer handoff (#180): a prefetch still waiting for idle time when a table has
// already taken the warm-up (or found none) makes no second renderer.

import { beforeEach, expect, it, vi } from 'vitest';

const warmLobby = vi.fn(async () => ({ warmupMs: 1 }));
vi.mock('./renderer', () => ({ warmLobby }));

beforeEach(() => {
	vi.resetModules();
	warmLobby.mockClear();
	vi.stubGlobal('requestIdleCallback', undefined);
	vi.useFakeTimers();
});

it('warms once for the table that takes it', async () => {
	const { prefetchRenderer, takeWarmRenderer } = await import('./load');
	prefetchRenderer();
	await vi.runAllTimersAsync();
	expect(await takeWarmRenderer()).toEqual({ warmupMs: 1 });
	expect(await takeWarmRenderer()).toBeNull();
	expect(warmLobby).toHaveBeenCalledOnce();
});

it('makes no renderer when a table took before the idle prefetch ran', async () => {
	const { prefetchRenderer, takeWarmRenderer } = await import('./load');
	prefetchRenderer();
	expect(await takeWarmRenderer()).toBeNull();
	await vi.runAllTimersAsync();
	expect(warmLobby).not.toHaveBeenCalled();
	// Back in the lobby: warms again.
	prefetchRenderer();
	await vi.runAllTimersAsync();
	expect(warmLobby).toHaveBeenCalledOnce();
});
