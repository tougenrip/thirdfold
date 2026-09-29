import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { LICENSES } from '../../src/lib/assets/manifest';
import { parseManifest } from '../../src/lib/assets/manifest-parse';
import { ADVENTURES } from '../adventures';
import { writeGlb } from './glb';
import { checkCredits, creditOf, readProvenance, storyNames } from './licence';
import { bakeModel, readModelSource } from './models';
import { buildAssets, type BuiltAssets } from './pipeline';
import { encodePng } from './png';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

const hash = 'a'.repeat(64);
const cc0 = {
	license: 'CC0-1.0',
	author: 'ambientCG',
	source: { url: 'https://ambientcg.com/view?id=Rock030', sha256: hash },
	modified: true
};
const ai = { tool: 'Meshy', version: '5', plan: 'paid', date: '2026-10-01' };

let built: BuiltAssets;
beforeAll(() => {
	built = buildAssets('assets');
});

describe('provenance', () => {
	const refused = (raw: unknown) => () => readProvenance(raw, 'x.meta.json');

	it('reads an allowlisted record, and credits it in brief', () => {
		const p = readProvenance({ ...cc0, ai }, 'x.meta.json');
		expect(creditOf(p)).toEqual({
			license: 'CC0-1.0',
			author: 'ambientCG',
			source: cc0.source.url,
			modified: true,
			ai: { tool: 'Meshy' }
		});
		expect(
			creditOf(readProvenance({ license: LICENSES[3], author: 'us', modified: false }, 'x'))
		).toEqual({ license: LICENSES[3], author: 'us' });
	});

	it('refuses store, non-commercial and unknown licences, naming the file', () => {
		expect(refused({ ...cc0, license: 'LicenseRef-synty' })).toThrow(
			/x\.meta\.json: licence "LicenseRef-synty" is not allowed/
		);
		expect(refused({ ...cc0, license: 'CC-BY-NC-4.0' })).toThrow(/"CC-BY-NC-4.0" is not allowed/);
		expect(refused({ ...cc0, license: undefined })).toThrow(/not allowed/);
	});

	it('needs a source URL and hash for CC0 and CC-BY, and an author for all', () => {
		expect(refused({ ...cc0, license: 'CC-BY-4.0', source: undefined })).toThrow(
			/CC-BY-4.0 needs a source/
		);
		expect(refused({ ...cc0, source: undefined })).toThrow(/CC0-1.0 needs a source/);
		expect(refused({ ...cc0, source: { url: 'http://x.org', sha256: hash } })).toThrow(/https/);
		expect(refused({ ...cc0, source: { url: 'https://x.org' } })).toThrow(/sha256/);
		expect(refused({ ...cc0, author: ' ' })).toThrow(/author/);
		expect(refused({ ...cc0, modified: undefined })).toThrow(/modified/);
	});

	it('refuses unrepainted AI, free plans and denied tools', () => {
		expect(refused({ ...cc0, modified: false, ai })).toThrow(/repainted by a person/);
		expect(refused({ ...cc0, ai: { ...ai, plan: 'free' } })).toThrow(/paid or self-hosted/);
		expect(refused({ ...cc0, ai: { ...ai, tool: 'Hunyuan3D-2' } })).toThrow(/refused/);
		expect(refused({ ...cc0, ai: { ...ai, date: 'yesterday' } })).toThrow(/date/);
	});
});

describe('the build', () => {
	let dir: string | undefined;
	afterEach(() => {
		if (dir) rmSync(dir, { recursive: true, force: true });
		dir = undefined;
	});
	/** A copy of the real sources to change, without the grades (they take seconds to render). */
	const sources = () => {
		dir = mkdtempSync(path.join(tmpdir(), 'thirdfold-licence-'));
		cpSync('assets', dir, { recursive: true });
		rmSync(path.join(dir, 'grades'), { recursive: true });
		return dir;
	};
	const glb = () =>
		writeGlb(
			bakeModel(
				readModelSource(
					{ parts: [{ shape: 'box', size: [1, 1, 1], at: [0, 0.5, 0], color: '#808080' }] },
					new Set()
				),
				() => '#808080'
			)
		);

	it('credits every file with an allowlisted licence, the backfilled ones as ours', () => {
		const { manifest } = built;
		const files = [
			...Object.values(manifest.models),
			...Object.values(manifest.textures),
			...Object.values(manifest.audio)
		];
		expect(files.length).toBeGreaterThan(100);
		for (const f of files) {
			expect(LICENSES).toContain(f.credit.license);
			expect(f.credit).toEqual({
				license: 'LicenseRef-thirdfold-original',
				author: 'thirdfold contributors'
			});
		}
	});

	it('refuses a source with no provenance', () => {
		const src = sources();
		rmSync(path.join(src, 'textures', '_provenance.json'));
		expect(() => buildAssets(src)).toThrow(/cave\.json: no provenance/);
	});

	it('refuses a folder default granting anything but thirdfold-original', () => {
		const src = sources();
		writeFileSync(path.join(src, 'audio', '_provenance.json'), JSON.stringify(cc0));
		expect(() => buildAssets(src)).toThrow(
			/audio\/_provenance\.json: a folder default may only grant/
		);
	});

	it('refuses a binary file relying on its folder default', () => {
		const src = sources();
		writeFileSync(path.join(src, 'textures', 'moss.png'), encodePng(4, 4, new Uint8Array(64)));
		expect(() => buildAssets(src)).toThrow(/moss\.png: no provenance/);
		writeFileSync(
			path.join(src, 'textures', 'moss.meta.json'),
			JSON.stringify({ usage: 'albedo' })
		);
		expect(() => buildAssets(src)).toThrow(/moss\.png: no provenance/);
		writeFileSync(
			path.join(src, 'textures', 'moss.meta.json'),
			JSON.stringify({ usage: 'albedo', provenance: cc0 })
		);
		expect(buildAssets(src).manifest.textures.moss.credit).toMatchObject({
			license: 'CC0-1.0',
			source: cc0.source.url,
			modified: true
		});
	});

	it('refuses a model under a store licence, naming its meta.json', () => {
		const src = sources();
		writeFileSync(path.join(src, 'models', 'prop', 'stool.glb'), glb());
		writeFileSync(
			path.join(src, 'models', 'prop', 'stool.meta.json'),
			JSON.stringify({ provenance: { ...cc0, license: 'LicenseRef-synty' } })
		);
		expect(() => buildAssets(src)).toThrow(/stool\.meta\.json: licence "LicenseRef-synty"/);
	});

	it('refuses AI output on a free plan in a sound', () => {
		const src = sources();
		const wav = built.files.get(built.manifest.audio['bell-hand'].file)!;
		writeFileSync(path.join(src, 'audio', 'chime.wav'), wav);
		writeFileSync(
			path.join(src, 'audio', 'chime.meta.json'),
			JSON.stringify({ provenance: { ...cc0, ai: { ...ai, plan: 'free' } } })
		);
		expect(() => buildAssets(src)).toThrow(/chime\.meta\.json: AI output needs a paid/);
	});
});

describe('credits and ids', () => {
	it('never name the story in the real manifest', () => {
		expect(storyNames(ADVENTURES)).toContain('widow crane');
		expect(checkCredits(built.manifest, ADVENTURES)).toEqual([]);
	});

	it('flag a credit or id naming a story’s people, foes or places, whole names only', () => {
		const manifest = structuredClone(built.manifest);
		manifest.models.table.credit.author = 'Tobin Hale';
		manifest.textures.grass.credit.source = 'https://example.com/bell-keeper';
		manifest.models['widow-crane'] = manifest.models.chair;
		// Words of a name are not the name.
		manifest.textures.rock.credit.author = 'Crane & Moss Studio';
		expect(checkCredits(manifest, ADVENTURES)).toEqual([
			'model id "widow-crane" names the story ("widow crane")',
			'model table author "Tobin Hale" names the story ("tobin hale")',
			'texture grass source "https://example.com/bell-keeper" names the story ("bell keeper")'
		]);
	});

	it('are required by the manifest on every file, from the allowlist', () => {
		const raw = JSON.parse(JSON.stringify(built.manifest));
		expect(parseManifest(raw).ok).toBe(true);
		delete raw.models.table.credit;
		expect(parseManifest(raw)).toMatchObject({ ok: false, error: expect.stringMatching(/credit/) });
		raw.models.table.credit = { license: 'CC-BY-NC-4.0', author: 'x' };
		expect(parseManifest(raw)).toMatchObject({ ok: false });
	});
});
