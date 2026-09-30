import { describe, expect, it } from 'vitest';
import { DEFAULT_GRID } from './grid';
import type { Ambient, Light } from './lights';
import {
	blankScene,
	parseSceneFile,
	SCENE_FILE_VERSION,
	serializeScene,
	sharedScene,
	type SceneSource
} from './scene-file';
import { emptyMask, encodeMask } from './visibility';
import { canonicalTime, DEFAULT_WORLD, type WorldLook } from './world';

const light = (id: string, x = 4, y = 4): Light => ({
	id,
	pos: { x, y },
	radius: 5,
	color: '#ffa04d',
	on: true
});

function source(ambient: Ambient = 'dark'): SceneSource {
	return {
		grid: DEFAULT_GRID,
		tokens: [
			{
				id: 'hero-1',
				name: 'Hero',
				color: '#2e86c1',
				pos: { x: 2, y: 3 },
				ownerId: 'p1',
				vision: 8,
				light: 3
			}
		],
		objects: [],
		props: [{ id: 'crate-1', assetId: 'crate', pos: { x: 6, y: 6 }, rotation: 0, scale: 1 }],
		lights: [light('l1')],
		ambient,
		fog: { enabled: true, revealed: emptyMask(DEFAULT_GRID), shared: false },
		playerName: (id) => (id === 'p1' ? 'Pip' : undefined)
	};
}

const json = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const explored = () => {
	const mask = emptyMask(DEFAULT_GRID);
	mask[3] = 1;
	return mask;
};

/** A v10 file taken back to version `v`, as that version's saves were written. */
function older(v: number, ambient: Ambient) {
	const d: Record<string, unknown> = JSON.parse(
		JSON.stringify(serializeScene('Crypt', source(ambient), new Date(0)))
	);
	d.version = v;
	delete d.world;
	delete d.interior;
	d.discovery = { Pip: encodeMask(explored()) };
	const drop = (from: number, ...keys: string[]) => {
		if (v < from) for (const k of keys) delete d[k];
	};
	drop(9, 'floor');
	drop(8, 'environment');
	drop(7, 'darkness');
	drop(6, 'discovery');
	if (v < 6) delete (d.fog as Record<string, unknown>).shared;
	drop(5, 'terrain');
	drop(4, 'adventure');
	drop(3, 'props');
	drop(2, 'lights', 'ambient');
	if (v < 2) for (const t of d.tokens as Record<string, unknown>[]) delete t.light;
	return d;
}

describe('scene file v10: the world look, roofs, remembered lights and looks', () => {
	for (let v = 1; v <= 9; v++) {
		for (const ambient of (v === 1 ? ['day'] : ['day', 'dusk', 'dark']) as Ambient[]) {
			it(`migrates a v${v} save at ${ambient} to the band's hour under a sun`, () => {
				const parsed = parseSceneFile(older(v, ambient));
				if (!parsed.ok) throw new Error(parsed.error);
				const { scene } = parsed;
				expect(scene.version).toBe(SCENE_FILE_VERSION);
				expect(scene.ambient).toBe(ambient);
				expect(scene.world).toEqual({ ...DEFAULT_WORLD, time: canonicalTime(ambient) });
				expect(scene.interior).toBeNull();
				expect(scene.discovery).toEqual(
					v >= 6 ? { Pip: { explored: encodeMask(explored()) } } : {}
				);
			});
		}
	}

	const look: WorldLook = {
		time: 1395,
		rate: 2,
		sun: false,
		sky: 'night-sky',
		weather: { kind: 'rain', intensity: 0.5, seed: 1234, since: 99 },
		haze: { density: 0.3, color: '#223344' },
		grade: { preset: 'cool-dusk', exposure: -0.5 },
		backdrop: { kind: 'mountains', level: 3 }
	};

	function full(): SceneSource {
		const src = source('dusk');
		const roofs = emptyMask(DEFAULT_GRID);
		roofs[41] = roofs[42] = 1;
		return {
			...src,
			world: look,
			interior: roofs,
			tokens: [...src.tokens].map((t) => ({ ...t, scale: 1.5, lift: 2, lightColor: '#ffeecc' })),
			props: [...src.props].map((p) => ({ ...p, tint: '#aa8866', variant: 3 })),
			lights: [
				{
					...light('l1'),
					kind: 'brazier',
					intensity: 2.5,
					height: 1,
					flicker: 'fire',
					shadows: true,
					fixture: false,
					facing: 2
				}
			],
			discovery: [
				['Pip', { explored: explored(), lights: [light('l1'), light('gone', 9, 9)] }],
				['Ana', { explored: explored() }]
			]
		};
	}

	it('round-trips every new field unchanged', () => {
		const file = serializeScene('Crypt', full(), new Date(0));
		expect(file.ambient).toBe('dusk');
		expect(file.world).toEqual(look);
		expect(file.discovery.Pip.lights).toHaveLength(2);
		expect(file.discovery.Ana).toEqual({ explored: encodeMask(explored()) });
		expect(parseSceneFile(json(file))).toEqual({ ok: true, scene: file });
	});

	it('derives the band from a sunlit hour, and keeps a sunless table’s band', () => {
		const file = json(serializeScene('Crypt', source('day'), new Date(0)));
		const at = (time: number, sun = true) =>
			parseSceneFile({ ...file, world: { ...file.world, time, sun } });
		expect(at(1380)).toMatchObject({ ok: true, scene: { ambient: 'dark' } });
		expect(at(1200)).toMatchObject({ ok: true, scene: { ambient: 'dusk' } });
		expect(at(1380, false)).toMatchObject({ ok: true, scene: { ambient: 'day' } });
	});

	it('saves the hour inside the band being saved', () => {
		const file = serializeScene('Crypt', { ...source('dark'), world: DEFAULT_WORLD });
		expect(file.world.time).toBe(canonicalTime('dark'));
		expect(file.ambient).toBe('dark');
		const dusk = serializeScene('Crypt', { ...source('dusk'), world: { ...look, sun: true } });
		expect(dusk.world.time).toBe(canonicalTime('dusk'));
		const sunless = serializeScene('Crypt', { ...source('day'), world: look });
		expect(sunless).toMatchObject({ ambient: 'day', world: { time: 1395 } });
	});

	type Mutation = (d: ReturnType<typeof saved>) => void;
	const saved = () => JSON.parse(JSON.stringify(serializeScene('Crypt', full(), new Date(0))));
	it.each<[string, Mutation, RegExp]>([
		['an unknown light kind', (d) => (d.lights[0].kind = 'laser'), /look/],
		['a light of intensity 5', (d) => (d.lights[0].intensity = 5), /look/],
		['a light facing 4', (d) => (d.lights[0].facing = 4), /look/],
		['a bad tint', (d) => (d.props[0].tint = 'red'), /look/],
		['a variant past 255', (d) => (d.props[0].variant = 256), /look/],
		['a giant miniature', (d) => (d.tokens[0].scale = 9), /look/],
		['a bad carried light colour', (d) => (d.tokens[0].lightColor = 'x'), /look/],
		['roofs of the wrong length', (d) => (d.interior = btoa('abc')), /roofed cells/],
		['roofs that are not base64', (d) => (d.interior = '%%%'), /roofed cells/],
		['an unknown weather', (d) => (d.world.weather.kind = 'hail'), /world look/],
		['no world at all', (d) => delete (d as { world?: unknown }).world, /world look/],
		['a discovery that is only a mask', (d) => (d.discovery.Pip = 'AAAA'), /discovery/],
		[
			'101 remembered lights',
			(d) =>
				(d.discovery.Pip.lights = Array.from({ length: 101 }, (_, i) => light(`l${i}`, i % 20))),
			/remembered lights/
		],
		[
			'two remembered lights with one id',
			(d) => (d.discovery.Pip.lights = [light('a'), light('a')]),
			/remembered lights/
		],
		[
			'a remembered light off the map',
			(d) => (d.discovery.Pip.lights = [light('a', 30, 0)]),
			/off the map/
		]
	])('rejects %s', (_label, mutate, error) => {
		const data = saved();
		mutate(data);
		const parsed = parseSceneFile(data);
		expect(!parsed.ok && parsed.error).toMatch(error);
	});

	it('makes a blank table with a world, in the band its hour gives', () => {
		const night = blankScene('Field', 8, 8, null, new Date(0), { ...DEFAULT_WORLD, time: 1320 });
		expect(night).toMatchObject({ ambient: 'dark', world: { time: 1320 }, interior: null });
		const cave = blankScene('Cave', 8, 8, null, new Date(0), { ...DEFAULT_WORLD, sun: false });
		expect(cave.ambient).toBe('day');
		expect(blankScene('Field', 8, 8, null).world).toEqual(DEFAULT_WORLD);
	});

	it('shares a table with its look and roofs, without anyone’s discoveries', () => {
		const file = serializeScene('Crypt', full());
		const shared = sharedScene(file);
		expect(shared.world).toEqual(file.world);
		expect(shared.interior).toBe(file.interior);
		expect(shared.discovery).toEqual({});
		expect(JSON.stringify(shared)).not.toContain('gone');
	});
});
