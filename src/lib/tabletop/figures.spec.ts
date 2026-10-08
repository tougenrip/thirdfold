// The figure batches (#266) without a GPU: the swap-remove slots, no leaks after churn, each
// instance's matrix and paint, a late model taking over from the placeholder, and picking.

import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { FigureBatches, Slots, type Batch, type ModelSource } from './figures';
import { SHADOW_PROXY } from './lod';
import { withBake, PAINT_ATTRIBUTE } from './materials';
import type { LoadedModel, ModelPart } from './models';

/** A part of the model attribute set: position, normal, uv, colour, bake. */
function part(
	role: 'body' | 'accent',
	size: number,
	textured = false,
	pose = 0,
	lod = 0
): ModelPart {
	const geometry = new THREE.BoxGeometry(size, size, size);
	const n = geometry.getAttribute('position').count;
	geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
	withBake(geometry);
	return {
		role,
		lod,
		pose,
		geometry,
		maps: textured ? { albedo: new THREE.Texture() } : null,
		params: {}
	};
}

const model = (id: string, parts: ModelPart[], levels = 0) =>
	({
		entry: { file: id, lods: levels ? Array(levels).fill({}) : undefined },
		parts
	}) as unknown as LoadedModel;

const MODELS: Record<string, LoadedModel> = {
	hound: model('hound', [part('body', 0.5)]),
	warden: model('warden', [part('body', 0.6), part('accent', 0.2)]),
	statue: model('statue', [part('body', 0.7, true)]),
	keeper: model('keeper', [part('body', 0.9), part('accent', 0.3)]),
	// A cooked figure with two coarser levels (#274).
	sculpt: model(
		'sculpt',
		[0, 1, 2].flatMap((l) => [part('body', 0.9, false, 0, l), part('accent', 0.3, false, 0, l)]),
		2
	)
};

/** Looking from the origin: every figure close enough for level 0, or far enough for level 2. */
const camera = new THREE.PerspectiveCamera(45, 1);
const VIEW = { near: 1e5, far: 1 } as const;
/** The parts drawn: batches holding a figure (empty ones are kept, #276). */
const drawn = <K>(batches: Map<K, Batch>) =>
	[...batches].filter(([, b]) => b.slots.size > 0).map(([k]) => k);

/** Every model loaded at once. */
const loaded: ModelSource = { now: (id) => MODELS[id] ?? null, load: () => Promise.resolve() };

/** A seeded random (mulberry32). */
function random(seed: number) {
	return () => {
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

describe('swap-remove slots', () => {
	it('keep ids packed, moving the last into a freed slot', () => {
		const slots = new Slots();
		for (const id of ['a', 'b', 'c', 'd']) slots.add(id);
		expect(slots.remove('b')).toEqual({ slot: 1, from: 3 });
		expect(slots.owners).toEqual(['a', 'd', 'c']);
		expect(slots.slotOf('d')).toBe(1);
		expect(slots.remove('c')).toEqual({ slot: 2, from: 2 });
		expect(slots.remove('zz')).toBeNull();
		expect(slots.owners).toEqual(['a', 'd']);
		expect(slots.slotOf('b')).toBeUndefined();
	});
});

describe('figure batches', () => {
	it('leak nothing after 200 random adds, removes, recolours, hides and model changes', () => {
		const group = new THREE.Group();
		const figures = new FigureBatches(group, () => {}, loaded);
		const rand = random(266);
		const ids = Array.from({ length: 24 }, (_, i) => `t${i}`);
		const models = [null, 'hound', 'warden', 'statue', 'keeper', 'sculpt'];
		/** Each figure's level as chooseLods last set it (kept across model changes). */
		const lodOf = new Map<string, number>();
		const colours = ['#ff0000', '#00ff00', '#3366ff'];
		const live = new Map<string, { model: string | null; color: string; opacity: number }>();
		const pick = <T>(of: readonly T[]) => of[Math.floor(rand() * of.length)];
		const matrixOf = (id: string) =>
			new THREE.Matrix4().makeTranslation(Number(id.slice(1)), 0, Math.fround(rand()));
		const placed = new Map<string, THREE.Matrix4>();

		for (let step = 0; step < 200; step++) {
			const id = pick(ids);
			const now = live.get(id);
			const op = rand();
			if (op > 0.9) {
				// The camera changed: the sculpts move to their level's batches.
				const view = pick(['near', 'far'] as const);
				figures.chooseLods(camera, VIEW[view], 0);
				for (const [tid, f] of live)
					if (f.model === 'sculpt') lodOf.set(tid, view === 'far' ? 2 : 0);
			} else if (now && op < 0.25) {
				figures.remove(id);
				live.delete(id);
				placed.delete(id);
				lodOf.delete(id);
			} else {
				if (!now) lodOf.set(id, 0);
				const next = {
					model: now && op < 0.5 ? now.model : pick(models),
					color: pick(colours),
					opacity: rand() < 0.3 ? 0.35 : 1
				};
				figures.set(id, next.model, next.color, next.opacity);
				live.set(id, next);
				if (!now || rand() < 0.5) {
					const m = matrixOf(id);
					figures.place(id, m);
					placed.set(id, m);
				}
			}

			// Every batch holds exactly the figures drawn with its part, packed.
			const expected = new Map<ModelPart | 'plain', string[]>();
			const proxies = new Map<ModelPart, string[]>();
			for (const [tid, f] of live) {
				const lod = lodOf.get(tid)!;
				const parts: (ModelPart | 'plain')[] = f.model
					? MODELS[f.model].parts.filter((p) => p.lod === (f.model === 'sculpt' ? lod : 0))
					: ['plain'];
				for (const p of parts) expected.set(p, [...(expected.get(p) ?? []), tid]);
				// A sculpt casts through its cheapest level's proxies, whatever level it draws.
				if (f.model === 'sculpt')
					for (const p of MODELS.sculpt.parts.filter((q) => q.lod === 2))
						proxies.set(p, [...(proxies.get(p) ?? []), tid]);
			}
			for (const key of proxies.keys()) expect(figures.proxies.has(key)).toBe(true);
			for (const [key, batch] of figures.proxies) {
				if (!proxies.has(key)) expect(batch.keep && !batch.mesh.visible).toBe(true);
				expect([...batch.slots.owners].sort()).toEqual((proxies.get(key) ?? []).sort());
				expect(batch.mesh.count).toBe(batch.slots.size);
				expect(batch.mesh.castShadow).toBe(true);
				expect(batch.mesh.layers.mask).toBe(1 << SHADOW_PROXY);
				batch.slots.owners.forEach((tid, i) => {
					const at = new THREE.Matrix4().fromArray(batch.mesh.instanceMatrix.array, i * 16);
					expect(at.elements).toEqual((placed.get(tid) ?? new THREE.Matrix4()).elements);
				});
			}
			// Nothing empty is freed but a preview's batch: a program would go with it (#276).
			for (const key of expected.keys()) expect(figures.batches.has(key)).toBe(true);
			for (const [key, batch] of figures.batches) {
				if (!expected.has(key))
					expect(batch.keep && batch.slots.size === 0 && !batch.mesh.visible).toBe(true);
				expect(batch.mesh.count).toBe(batch.slots.size);
				expect([...batch.slots.owners].sort()).toEqual((expected.get(key) ?? []).sort());
				expect(batch.mesh.parent).toBe(group);
				// A level of a model with levels casts nothing: its proxy does.
				expect(batch.mesh.castShadow).toBe(batch.shadow === 'cast');
				expect(batch.shadow).toBe(
					key !== 'plain' && MODELS.sculpt.parts.includes(key) ? 'none' : 'cast'
				);
				const paint = batch.paints.array;
				batch.slots.owners.forEach((tid, i) => {
					const f = live.get(tid)!;
					const tint = batch.role === 'body' ? [1, 1, 1] : new THREE.Color(f.color).toArray();
					expect([...paint.slice(i * 4, i * 4 + 4)]).toEqual([...tint, f.opacity].map(Math.fround));
					const at = new THREE.Matrix4().fromArray(batch.mesh.instanceMatrix.array, i * 16);
					expect(at.elements).toEqual((placed.get(tid) ?? new THREE.Matrix4()).elements);
				});
			}
			// The scene holds only the batches: no orphaned meshes.
			expect(group.children.length).toBe(figures.batches.size + figures.proxies.size);
		}
		for (const id of [...live.keys()]) figures.remove(id);
		// Every batch is kept, empty (#276): none of these is a preview's.
		const all = [...figures.batches.values(), ...figures.proxies.values()];
		expect(all.every((b) => b.keep && b.slots.size === 0 && !b.mesh.visible)).toBe(true);
		expect(group.children.length).toBe(all.length);
		figures.dispose();
		expect(group.children).toEqual([]);
	});

	it('grow a batch past its pool without losing an instance', () => {
		const figures = new FigureBatches(new THREE.Group(), () => {}, loaded);
		const n = 1100;
		for (let i = 0; i < n; i++) {
			figures.set(`t${i}`, 'hound', '#ffffff', 1);
			figures.place(`t${i}`, new THREE.Matrix4().makeTranslation(i, 0, 0));
		}
		const [batch] = figures.batches.values();
		expect(batch.mesh.count).toBe(n);
		expect(batch.mesh.instanceMatrix.count).toBeGreaterThanOrEqual(n);
		const at = new THREE.Matrix4();
		batch.mesh.getMatrixAt(n - 1, at);
		expect(new THREE.Vector3().setFromMatrixPosition(at).x).toBe(n - 1);
		batch.mesh.getMatrixAt(3, at);
		expect(new THREE.Vector3().setFromMatrixPosition(at).x).toBe(3);
		figures.dispose();
	});

	it('hide a token by its paint alone, on the same material', () => {
		const figures = new FigureBatches(new THREE.Group(), () => {}, loaded);
		figures.set('a', 'warden', '#ff0000', 1);
		const materials = [...figures.batches.values()].map((b) => b.material);
		expect(figures.set('a', 'warden', '#ff0000', 0.35)).toBe(true);
		expect([...figures.batches.values()].map((b) => b.material)).toEqual(materials);
		for (const b of figures.batches.values()) {
			expect(b.mesh.geometry.getAttribute(PAINT_ATTRIBUTE).getW(0)).toBeCloseTo(0.35);
			expect(b.material.transparent).toBe(false);
		}
		expect(figures.set('a', 'warden', '#ff0000', 0.35)).toBe(false);
		figures.dispose();
	});

	it('draw the placeholder until a late model arrives, then the model', async () => {
		const shelf: { ready?: LoadedModel } = {};
		let arrive = () => {};
		const late: ModelSource = {
			now: () => shelf.ready,
			load: () => new Promise<void>((r) => (arrive = r))
		};
		let redraws = 0;
		const figures = new FigureBatches(new THREE.Group(), () => redraws++, late);
		figures.set('a', 'warden', '#ff0000', 1);
		expect(drawn(figures.batches)).toEqual(['plain']);
		shelf.ready = MODELS.warden;
		arrive();
		await Promise.resolve();
		await Promise.resolve();
		expect(redraws).toBe(1);
		expect(drawn(figures.batches)).toEqual(MODELS.warden.parts);
		figures.dispose();
	});

	it('switch levels only when the camera crosses a threshold, keeping the proxies', () => {
		const figures = new FigureBatches(new THREE.Group(), () => {}, loaded);
		for (let i = 0; i < 5; i++) {
			figures.set(`t${i}`, 'sculpt', '#ffffff', 1);
			figures.place(`t${i}`, new THREE.Matrix4().makeTranslation(i + 1, 0, 0));
		}
		const levels = () =>
			drawn(figures.batches)
				.map((k) => (k === 'plain' ? -1 : k.lod))
				.sort();
		expect(levels()).toEqual([0, 0]);
		const proxies = [...figures.proxies.values()];
		expect(figures.chooseLods(camera, VIEW.near, 0)).toBe(false); // already there: nothing moves
		expect(figures.chooseLods(camera, VIEW.far, 0)).toBe(true);
		expect(levels()).toEqual([2, 2]);
		expect(figures.instances()).toBe(10);
		expect(figures.chooseLods(camera, VIEW.far, 0)).toBe(false);
		// The proxies are the same batches throughout, holding every figure.
		expect([...figures.proxies.values()]).toEqual(proxies);
		for (const b of proxies) expect(b.slots.size).toBe(5);
		// The low tier's bias: one level coarser from close up.
		expect(figures.chooseLods(camera, VIEW.near, 1)).toBe(true);
		expect(levels()).toEqual([1, 1]);
		// A part list has one level: it casts itself, with no proxy.
		figures.set('h', 'hound', '#ffffff', 1);
		expect(figures.batches.get(MODELS.hound.parts[0])!.mesh.castShadow).toBe(true);
		expect(figures.proxies.size).toBe(2);
		figures.dispose();
	});

	it('pick the token under the ray, mid-move too', () => {
		const group = new THREE.Group();
		const figures = new FigureBatches(group, () => {}, loaded);
		for (const [i, id] of ['a', 'b', 'c'].entries()) {
			figures.set(id, 'hound', '#ffffff', 1);
			figures.place(id, new THREE.Matrix4().makeTranslation(i * 2, 0, 0));
		}
		figures.remove('a'); // 'c' moves into slot 0
		figures.place('b', new THREE.Matrix4().makeTranslation(5, 0, 0)); // moved since
		const ray = (x: number) => {
			const r = new THREE.Raycaster(new THREE.Vector3(x, 5, 0), new THREE.Vector3(0, -1, 0));
			r.layers.enableAll();
			const hit = r.intersectObject(group, true)[0];
			return hit ? figures.tokenOf(hit) : null;
		};
		expect(ray(4)).toBe('c');
		expect(ray(5)).toBe('b');
		expect(ray(2)).toBeNull();
		expect(ray(0)).toBeNull();
		figures.dispose();
	});

	it('pose a figure by moving it between batches, leaking no slot (#273)', () => {
		const ranger = {
			entry: { file: 'ranger', poses: { downed: 1, active: 2 } },
			parts: [part('body', 0.6), part('body', 0.4, false, 1), part('body', 0.5, true, 2)]
		} as unknown as LoadedModel;
		const [body, down, active] = ranger.parts;
		const source: ModelSource = {
			now: (id) => (id === 'ranger' ? ranger : (MODELS[id] ?? null)),
			load: () => Promise.resolve()
		};
		const group = new THREE.Group();
		const figures = new FigureBatches(group, () => {}, source);
		figures.set('a', 'ranger', '#ff0000', 1);
		figures.set('b', 'ranger', '#00ff00', 1);
		figures.set('h', 'hound', '#ffffff', 1);
		const painted = figures.batches.get(body)!.material;
		const holders = (p: ModelPart) => [...(figures.batches.get(p)?.slots.owners ?? [])].sort();

		expect(figures.setState('a', { downed: true, active: false })).toBe(true);
		expect(holders(body)).toEqual(['b']);
		expect(holders(down)).toEqual(['a']);
		expect(figures.showsDowned('a')).toBe(true);
		expect(figures.batches.get(down)!.material).toBe(painted); // nothing new to compile
		// Down on its turn: still down; the same state again changes nothing.
		expect(figures.setState('a', { downed: true, active: true })).toBe(false);
		// A model with no poses keeps its body (and tips over: showsDowned is false).
		expect(figures.setState('h', { downed: true, active: true })).toBe(false);
		expect(figures.showsDowned('h')).toBe(false);

		figures.setState('b', { downed: false, active: true });
		expect(holders(active)).toEqual(['b']);
		expect(figures.showsDowned('b')).toBe(false);
		// Revived and the turn passed: both back on the body; the poses' batches kept empty, so
		// their programs stay (#276).
		figures.setState('a', { downed: false, active: false });
		figures.setState('b', { downed: false, active: false });
		expect(holders(body)).toEqual(['a', 'b']);
		for (const p of [down, active]) expect(figures.batches.get(p)?.mesh.visible).toBe(false);
		expect(group.children.length).toBe(figures.batches.size);

		// Churn: every batch stays packed and nothing is left behind.
		const rand = random(273);
		for (let step = 0; step < 100; step++) {
			const id = rand() < 0.5 ? 'a' : 'b';
			figures.setState(id, { downed: rand() < 0.4, active: rand() < 0.4 });
			for (const b of figures.batches.values()) expect(b.mesh.count).toBe(b.slots.size);
			expect(figures.instances()).toBe(3);
			expect(group.children.length).toBe(figures.batches.size);
		}
		for (const id of ['a', 'b', 'h']) figures.remove(id);
		expect(drawn(figures.batches)).toEqual([]);
		expect(figures.batches.size).toBe(4);
		figures.dispose();
	});

	it('keep a pose at its own level 0 from far off when it has no levels (#273, #274)', () => {
		// Body at three levels; the downed pose only at level 0.
		const ranger = {
			entry: { file: 'ranger', poses: { downed: 1 }, lods: [{}, {}] },
			parts: [...[0, 1, 2].map((l) => part('body', 0.6, false, 0, l)), part('body', 0.4, false, 1)]
		} as unknown as LoadedModel;
		const [body0, , body2, down] = ranger.parts;
		const group = new THREE.Group();
		const figures = new FigureBatches(group, () => {}, {
			now: () => ranger,
			load: () => Promise.resolve()
		});
		figures.set('a', 'ranger', '#ff0000', 1);
		figures.place('a', new THREE.Matrix4().makeTranslation(3, 0, 0));
		figures.chooseLods(camera, VIEW.far, 0);
		expect(drawn(figures.batches)).toEqual([body2]);
		expect(drawn(figures.proxies)).toEqual([body2]);
		// Downed far off: the pose's own level 0, never the standing body; its proxy too.
		figures.setState('a', { downed: true, active: false });
		expect(drawn(figures.batches)).toEqual([down]);
		expect(drawn(figures.proxies)).toEqual([down]);
		// Close up: nothing to switch to, but the level asked for is kept for when it stands.
		expect(figures.chooseLods(camera, VIEW.near, 0)).toBe(false);
		figures.setState('a', { downed: false, active: false });
		expect(drawn(figures.batches)).toEqual([body0]);
		expect(figures.chooseLods(camera, VIEW.far, 0)).toBe(true);
		expect(drawn(figures.batches)).toEqual([body2]);
		figures.remove('a');
		expect(group.children.every((c) => !c.visible)).toBe(true);
		figures.dispose();
		expect(group.children).toEqual([]);
	});

	it("keep a preview's body: the pose waits for the full model", () => {
		const preview = {
			entry: { file: 'ranger', poses: { downed: 1 } },
			parts: [part('body', 0.6)],
			preview: true
		} as unknown as LoadedModel;
		const figures = new FigureBatches(new THREE.Group(), () => {}, {
			now: () => preview,
			load: () => new Promise(() => {})
		});
		figures.set('a', 'ranger', '#ff0000', 1);
		expect(figures.setState('a', { downed: true, active: false })).toBe(false);
		expect(figures.showsDowned('a')).toBe(false);
		figures.dispose();
	});
});
