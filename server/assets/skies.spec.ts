import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseManifest } from '../../src/lib/assets/manifest-parse';
import { parseSky, resolveSky } from '../../src/lib/assets/sky-parse';
import { DEFAULT_WORLD } from '../../src/lib/game/world';
import { buildSkies } from './pipeline-skies';

/** The built manifest as the client fetches it (pipeline.spec.ts checks it is what assets/ builds). */
const raw = JSON.parse(readFileSync(path.join('static', 'assets', 'manifest.json'), 'utf8'));
const source = (id: string) =>
	JSON.parse(readFileSync(path.join('assets', 'skies', `${id}.json`), 'utf8'));
const parsed = parseManifest(raw);
const manifest = parsed.ok ? parsed.manifest : (undefined as never);

describe('skies (#213)', () => {
	it('ship six, and every environment names one', () => {
		expect(parsed.ok).toBe(true);
		expect(Object.keys(manifest.skies).sort()).toEqual([
			'abyss',
			'blood-moon',
			'desert-night',
			'overcast',
			'temperate',
			'underground'
		]);
		for (const env of Object.values(manifest.environments))
			expect(manifest.skies).toHaveProperty(env.sky);
		expect(manifest.skies.temperate.credit.license).toBe('LicenseRef-thirdfold-original');
	});

	it('keep today’s lights at the bands’ hours, so the look does not jump', () => {
		const at = (minute: number) => manifest.skies.temperate.keys.find((k) => k.minute === minute);
		expect(at(720)).toMatchObject({ sun: 1.6, hemi: 0.9, hemiSky: '#fff1dc', sunColor: '#ffe2b8' });
		expect(at(1170)).toMatchObject({ sun: 0.55, hemi: 0.45, hemiGround: '#1a2438' });
	});

	it('refuse unsorted keys, a bad colour, an enclosed sky with a sun or a path, an open one without', () => {
		const t = source('temperate');
		const bad = (change: (s: typeof t) => void) => {
			const s = structuredClone(t);
			change(s);
			return parseSky(s);
		};
		expect(parseSky(t).ok).toBe(true);
		expect(bad((s) => s.keys.reverse())).toMatchObject({ ok: false, error: /minutes must rise/ });
		expect(bad((s) => (s.keys[0].zenith = 'blue'))).toMatchObject({ ok: false, error: /zenith/ });
		expect(bad((s) => (s.keys[0].sunKelvin = 800))).toMatchObject({ ok: false });
		expect(bad((s) => (s.keys[0].fog.density = Infinity))).toMatchObject({ ok: false });
		expect(bad((s) => (s.keys = s.keys.slice(0, 1)))).toMatchObject({ ok: false });
		expect(bad((s) => delete s.path)).toMatchObject({ ok: false, error: /path/ });
		expect(bad((s) => (s.kind = 'hdri'))).toMatchObject({ ok: false });
		const u = source('underground');
		expect(parseSky(u).ok).toBe(true);
		expect(parseSky({ ...u, path: t.path })).toMatchObject({ ok: false, error: /no path/ });
		const lit = structuredClone(u);
		lit.keys[0].sunColor = '#ffffff';
		expect(parseSky(lit)).toMatchObject({ ok: false, error: /no sun/ });
		const unlit = structuredClone(u);
		delete unlit.keys[1].fill;
		expect(parseSky(unlit)).toMatchObject({ ok: false, error: /fill/ });
	});

	it('are refused by the manifest when broken, or when an environment names an unknown one', () => {
		const change = (f: (m: typeof raw) => void) => {
			const m = structuredClone(raw);
			f(m);
			return parseManifest(m);
		};
		expect(change((m) => (m.environments.village.sky = 'nowhere'))).toMatchObject({
			ok: false,
			error: 'environment village: unknown sky'
		});
		expect(change((m) => (m.skies.temperate.keys[1].minute = 0))).toMatchObject({ ok: false });
		expect(change((m) => delete m.skies.temperate.credit)).toMatchObject({ ok: false });
		expect(change((m) => (m.environments.village.world = { time: 'noon' }))).toMatchObject({
			ok: false
		});
		// Optional on the wire: without skies (and so without environments naming them) it reads as {}.
		const bare = change((m) => {
			delete m.skies;
			m.environments = {};
		});
		expect(bare.ok && bare.manifest.skies).toEqual({});
	});

	it('resolve the look’s sky, else the environment’s, else temperate; sunless shows underground', () => {
		const id = (world: Parameters<typeof resolveSky>[0], env: string | null) =>
			resolveSky(world, env, manifest)?.id;
		expect(id(null, 'ghost-town')).toBe('desert-night');
		expect(id(DEFAULT_WORLD, 'cavern')).toBe('abyss');
		expect(id({ sky: 'blood-moon', sun: true }, 'village')).toBe('blood-moon');
		expect(id({ sky: 'nowhere', sun: true }, 'village')).toBe('temperate');
		expect(id({ sky: null, sun: true }, 'nowhere')).toBe('temperate');
		expect(id({ sky: null, sun: false }, 'village')).toBe('underground');
		expect(id({ sky: 'abyss', sun: false }, 'village')).toBe('abyss');
		expect(resolveSky(null, null, { skies: {}, environments: {} })).toBeNull();
	});
});

describe('the skies step of the pipeline', () => {
	let dir = '';
	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
		dir = '';
	});
	const write = (sky: unknown) => {
		if (!dir) {
			dir = mkdtempSync(path.join(tmpdir(), 'thirdfold-skies-'));
			mkdirSync(path.join(dir, 'skies'));
		}
		writeFileSync(path.join(dir, 'skies', 'dawn.json'), JSON.stringify(sky));
		return dir;
	};

	it('credits each sky from its own provenance, which must be ours', () => {
		const t = source('temperate');
		expect(buildSkies(write(t)).dawn.credit).toEqual({
			license: 'LicenseRef-thirdfold-original',
			author: 'thirdfold contributors'
		});
		const bought = {
			...t,
			provenance: { ...t.provenance, license: 'LicenseRef-thirdfold-commissioned' }
		};
		expect(() => buildSkies(write(bought))).toThrow(/may only grant/);
		expect(() => buildSkies(write({ ...t, provenance: undefined }))).toThrow(/dawn\.json/);
		expect(() => buildSkies(write({ ...t, keys: [...t.keys].reverse() }))).toThrow(
			/dawn\.json: key 1: minutes must rise/
		);
	});
});
