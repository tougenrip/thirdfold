// Packs and previews in the pipeline (#192): every file in a pack named for a look, the packs'
// sizes, and a model's `.preview.json` part list built as its preview.

import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildAssets, type BuiltAssets } from './pipeline';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

let built: BuiltAssets;
beforeAll(async () => {
	built = await buildAssets('assets');
});

describe('packs', () => {
	it('put every file in a listed pack, named for a look, and add up their sizes', () => {
		const { models, textures, audio, environments, packs } = built.manifest;
		const looks = ['core', ...Object.keys(environments)];
		expect(Object.keys(packs).every((p) => looks.includes(p))).toBe(true);
		const total: Record<string, number> = {};
		for (const entry of [
			...Object.values(models),
			...Object.values(textures),
			...Object.values(audio)
		]) {
			expect(entry.pack && Object.hasOwn(packs, entry.pack)).toBe(true);
			const preview = 'preview' in entry ? (entry.preview?.bytes ?? 0) : 0;
			total[entry.pack!] = (total[entry.pack!] ?? 0) + entry.bytes + preview;
		}
		for (const [id, p] of Object.entries(packs)) expect(p.bytes, id).toBe(total[id]);
		// A floor only the village wears is the village's; the paint every prop wears is shared.
		const village = built.manifest.materials[environments.village.surface].map!;
		expect(textures[village].pack).toBe('village');
		expect(textures[environments.cavern.lut!.aces.day].pack).toBe('cavern');
		expect(textures['paint-normal'].pack).toBe('core');
		expect(models.barrel.pack).toBe('core');
	});
});

describe('the pipeline on other sources', () => {
	let dir: string;
	afterEach(() => rmSync(dir, { recursive: true, force: true }));
	const sources = () => {
		dir = mkdtempSync(path.join(tmpdir(), 'thirdfold-packs-'));
		cpSync('assets', dir, { recursive: true });
		return dir;
	};
	const cube = {
		parts: [{ shape: 'box', size: [0.5, 0.5, 0.5], at: [0, 0.25, 0], color: '#ffffff' }]
	};

	it('builds a model’s .preview.json as its preview, counted in its pack', async () => {
		const src = sources();
		writeFileSync(path.join(src, 'models', 'prop', 'well.preview.json'), JSON.stringify(cube));
		const { manifest, files } = await buildAssets(src);
		const { preview, pack } = manifest.models.well;
		expect(preview?.file).toMatch(/^previews\/well\.[0-9a-f]{8}\.glb$/);
		expect(files.get(preview!.file)!.length).toBe(preview!.bytes);
		expect(preview!.bytes).toBeLessThan(manifest.models.well.bytes);
		expect(preview!.credit.author).toBe('thirdfold contributors');
		expect(manifest.packs[pack!].bytes - built.manifest.packs[pack!].bytes).toBe(preview!.bytes);
	});

	it('refuses a preview without its model, or heavier than it', async () => {
		let src = sources();
		writeFileSync(path.join(src, 'models', 'prop', 'ghost.preview.json'), JSON.stringify(cube));
		await expect(buildAssets(src)).rejects.toThrow(
			/ghost\.preview\.json: a preview needs its model/
		);
		rmSync(dir, { recursive: true, force: true });
		src = sources();
		const heavy = {
			parts: Array.from({ length: 8 }, () => ({ ...cube.parts[0], shape: 'sphere' }))
		};
		writeFileSync(path.join(src, 'models', 'prop', 'crate.preview.json'), JSON.stringify(heavy));
		await expect(buildAssets(src)).rejects.toThrow(
			/crate\.preview\.json: a preview must be lighter/
		);
	});

	it('takes a model’s pack from its meta.json, and refuses one that is not an id', async () => {
		const src = sources();
		cpSync('tests/fixtures/assets/loader/cube.glb', path.join(src, 'models', 'npc', 'golem.glb'));
		const meta = (pack: unknown) =>
			JSON.stringify({
				pack,
				provenance: { license: 'LicenseRef-thirdfold-original', author: 'us', modified: false }
			});
		const file = path.join(src, 'models', 'npc', 'golem.meta.json');
		writeFileSync(file, meta('stone-halls'));
		const { manifest } = await buildAssets(src);
		expect(manifest.models.golem.pack).toBe('stone-halls');
		expect(manifest.packs['stone-halls'].bytes).toBeGreaterThan(
			built.manifest.packs['stone-halls'].bytes
		);
		writeFileSync(file, meta('../Hollow Bell'));
		await expect(buildAssets(src)).rejects.toThrow(/golem\.meta\.json: a pack is an asset id/);
	});
});
