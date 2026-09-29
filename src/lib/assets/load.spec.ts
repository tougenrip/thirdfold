import { createHash } from 'node:crypto';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const FILE = 'models/crate.0123abcd.glb';
const BYTES = new Uint8Array([1, 2, 3, 4]);
const SHA = createHash('sha256').update(BYTES).digest('hex');

/** load.ts as a page with `base` as its asset host and `secure` as its context would load it. */
async function loader(base: string, secure = true) {
	vi.resetModules();
	vi.stubEnv('VITE_ASSET_BASE_URL', base);
	vi.stubGlobal('isSecureContext', secure);
	const fetch = vi.fn<(url: string) => Promise<Response>>(async () => new Response(BYTES.slice()));
	vi.stubGlobal('fetch', fetch);
	const digest = vi.spyOn(crypto.subtle, 'digest');
	return { ...(await import('./load')), fetch, digest };
}

// Transformed once off the tests' clock: a busy full run can take seconds over the first import.
beforeAll(async () => {
	await import('./load');
}, 60_000);

afterEach(() => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('fetchAsset', () => {
	it('loads from the page’s own origin without a digest when no host is set', async () => {
		const { fetchAsset, fetch, digest } = await loader('');
		expect(new Uint8Array(await fetchAsset(FILE, 'not checked'))).toEqual(BYTES);
		expect(fetch.mock.calls[0][0]).toBe(`/assets/${FILE}`);
		expect(digest).not.toHaveBeenCalled();
	});

	it('loads from the host and checks the whole SHA-256', async () => {
		const { fetchAsset, fetch, digest } = await loader('https://cdn.example/assets/');
		expect(new Uint8Array(await fetchAsset(FILE, SHA))).toEqual(BYTES);
		expect(fetch.mock.calls[0][0]).toBe(`https://cdn.example/assets/${FILE}`);
		expect(digest).toHaveBeenCalledOnce();
	});

	it('refuses bytes from the host that are not the manifest’s', async () => {
		const { fetchAsset } = await loader('https://cdn.example/assets');
		await expect(fetchAsset(FILE, SHA.replace(/^./, SHA[0] === '0' ? '1' : '0'))).rejects.toThrow(
			/SHA-256 differs/
		);
	});

	it('falls back to its own origin without a secure context', async () => {
		const { fetchAsset, fetch, digest } = await loader('https://cdn.example/assets', false);
		await fetchAsset(FILE, 'not checked');
		expect(fetch.mock.calls[0][0]).toBe(`/assets/${FILE}`);
		expect(digest).not.toHaveBeenCalled();
	});

	it('refuses paths that are not built files', async () => {
		const { fetchAsset, fetch } = await loader('');
		await expect(fetchAsset('../secret.glb', SHA)).rejects.toThrow(/not an asset file/);
		expect(fetch).not.toHaveBeenCalled();
	});

	it('caps downloads at once, letting what is needed now go first', async () => {
		const { fetchAsset, fetch } = await loader('');
		const gates: (() => void)[] = [];
		fetch.mockImplementation(
			(url: string) =>
				new Promise<Response>((resolve) => gates.push(() => resolve(new Response(url))))
		);
		const file = (n: number) => `models/m${n}.0123abcd.glb`;
		const low = fetchAsset(file(0), '', 'low');
		const rest = [1, 2, 3, 4, 5, 6, 7].map((n) =>
			fetchAsset(file(n), '', n === 7 ? 'high' : 'low')
		);
		await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(6));
		gates.shift()!();
		await low;
		// The one wanted now goes ahead of the low one queued before it.
		await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(7));
		expect(fetch.mock.calls[6][0]).toBe(`/assets/${file(7)}`);
		while (gates.length) gates.shift()!();
		await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(8));
		gates.shift()!();
		await Promise.all(rest);
	});
});
