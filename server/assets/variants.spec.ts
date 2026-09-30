import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseManifest } from '../../src/lib/assets/manifest-parse';
import { buildAssets, manifestText } from './pipeline';
import {
	VARIANT_LOCK,
	readVariantLock,
	staleVariants,
	variantLockText,
	type VariantLock
} from './variants';

// Building every asset renders the colour grades and every recipe at 512 px: a few seconds.
vi.setConfig({ testTimeout: 60_000 });

const sha = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
const temps: string[] = [];
const temp = () => {
	const dir = mkdtempSync(path.join(tmpdir(), 'thirdfold-variants-'));
	temps.push(dir);
	return dir;
};
afterEach(() => temps.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

/** A lock with a 1K and a 2K copy of the grass recipe, whose files are `bytes`. */
function lockOf(bytes: Record<1024 | 2048, Uint8Array>): VariantLock {
	return {
		textures: {
			grass: ([1024, 2048] as const).map((size) => ({
				size,
				file: `textures/grass-${size / 1024}k.${sha(bytes[size]).slice(0, 8)}.png`,
				sha256: sha(bytes[size]),
				bytes: bytes[size].length,
				gpuBytes: Math.ceil((size * size * 16) / 3)
			}))
		},
		models: {}
	};
}

describe('texture detail variants in the build', () => {
	const files = { 1024: Buffer.from('a 1K copy'), 2048: Buffer.from('a 2K copy') };

	it('come from the lock alone: the manifest is the same whether the files are here or not', async () => {
		const src = temp();
		cpSync('assets', src, { recursive: true });
		const lock = lockOf(files);
		writeFileSync(path.join(src, VARIANT_LOCK), variantLockText(lock));
		const without = await buildAssets(src);
		const grass = without.manifest.textures.grass;
		expect(grass.variants?.map((v) => [v.size, v.file])).toEqual(
			lock.textures.grass.map((v) => [v.size, v.file])
		);
		expect(grass.variants?.[0].credit).toEqual(grass.credit);
		expect(parseManifest(JSON.parse(manifestText(without.manifest))).ok).toBe(true);
		// Never among the built files: they are not committed, and the store's lock is the base's.
		expect([...without.files.keys()].some((f) => f.includes('grass-1k'))).toBe(false);

		const root = temp();
		mkdirSync(path.join(root, 'textures'));
		for (const v of lock.textures.grass)
			writeFileSync(path.join(root, v.file), files[v.size as 1024 | 2048]);
		expect(staleVariants(root, readVariantLock(src))).toEqual([]);
		const withFiles = await buildAssets(src);
		expect(manifestText(withFiles.manifest)).toBe(manifestText(without.manifest));
	});

	it('check a variant file that is here against the lock, and skip one kept elsewhere', () => {
		const src = temp();
		const lock = lockOf(files);
		writeFileSync(path.join(src, VARIANT_LOCK), variantLockText(lock));
		const root = temp();
		mkdirSync(path.join(root, 'textures'));
		const [one] = lock.textures.grass;
		writeFileSync(path.join(root, one.file), 'something else');
		expect(staleVariants(root, readVariantLock(src))).toEqual([
			`${one.file} is not what ${VARIANT_LOCK} lists`
		]);
	});

	it('refuse variants of a texture the build does not make, and a malformed lock', async () => {
		const src = temp();
		cpSync('assets', src, { recursive: true });
		const lock = lockOf(files);
		lock.textures.moss = lock.textures.grass;
		writeFileSync(path.join(src, VARIANT_LOCK), variantLockText(lock));
		await expect(buildAssets(src)).rejects.toThrow(/variants of textures "moss"/);
		writeFileSync(
			path.join(src, VARIANT_LOCK),
			'{"textures":{"grass":[{"size":4096}]},"models":{}}'
		);
		expect(() => readVariantLock(src)).toThrow(/bad variants for grass/);
	});
});
