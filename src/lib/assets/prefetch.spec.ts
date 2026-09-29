// The prefetch planner (#192): its order, and that it plans only from what a viewer was sent.

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { testWorld } from '../../../server/fixtures/test-world';
import { fixtureViews } from '../../../server/fixtures/views';
import { parseManifest } from './manifest-parse';
import type { Manifest, ModelEntry } from './manifest';
import { plan, type PlanView } from './prefetch';

const parsed = parseManifest(JSON.parse(readFileSync('static/assets/manifest.json', 'utf8')));
if (!parsed.ok) throw new Error(parsed.error);
const manifest = parsed.manifest;

const VIEWS = 'tests/fixtures/views';
type Viewer = 'gm' | 'player' | 'spectator';
const views = readdirSync(VIEWS)
	.filter((f) => f.endsWith('.json'))
	.map((f) => ({
		name: f,
		...(JSON.parse(readFileSync(path.join(VIEWS, f), 'utf8')) as Record<Viewer, PlanView>)
	}));

/** Every asset id a viewer was sent: its environment, its tokens' models and its props. */
const sent = (v: PlanView) =>
	new Set([
		...(v.environment ? [v.environment] : []),
		...v.tokens.flatMap((t) => (t.model ? [t.model] : [])),
		...v.props.map((p) => p.assetId)
	]);

const ids = (view: PlanView, m: Manifest = manifest) =>
	plan(view, m, null)
		.filter((p) => p.kind !== 'decoders')
		.map((p) => p.id);

describe('the prefetch plan', () => {
	it('puts the environment first, then tokens’ models, then props’, nearest the focus', () => {
		const view: PlanView = {
			environment: 'village',
			tokens: [
				{ model: 'hound', pos: { x: 9, y: 9 } },
				{ model: 'warden', pos: { x: 1, y: 1 } },
				{ model: 'hound', pos: { x: 0, y: 0 } },
				{ pos: { x: 0, y: 0 } }
			],
			props: [
				{ assetId: 'barrel', pos: { x: 8, y: 8 } },
				{ assetId: 'crate', pos: { x: 2, y: 2 } },
				{ assetId: 'barrel', pos: { x: 7, y: 7 } },
				{ assetId: 'nothing-known', pos: { x: 0, y: 0 } }
			]
		};
		expect(plan(view, manifest, { x: 0, y: 0 })).toEqual([
			{ kind: 'environment', id: 'village', priority: 'high' },
			{ kind: 'model', id: 'hound', priority: 'low' },
			{ kind: 'model', id: 'warden', priority: 'low' },
			{ kind: 'model', id: 'crate', priority: 'low' },
			{ kind: 'model', id: 'barrel', priority: 'low' }
		]);
		// Without a focus, in the order they were sent; from the other corner, nearest it first.
		expect(ids(view).slice(1)).toEqual(['hound', 'warden', 'barrel', 'crate']);
		expect(plan(view, manifest, { x: 9, y: 9 }).map((p) => p.id)).toEqual([
			'village',
			'hound',
			'warden',
			'barrel',
			'crate'
		]);
	});

	it('plans every preview first, and the transcoder once when anything is cooked', () => {
		const m = structuredClone(manifest);
		const preview = { ...m.models.crate, file: 'previews/crate.0123abcd.glb' };
		m.models.crate = { ...m.models.crate, cooked: true, preview } as ModelEntry;
		m.models.barrel = { ...m.models.barrel, cooked: true } as ModelEntry;
		const view: PlanView = {
			environment: null,
			tokens: [],
			props: [
				{ assetId: 'barrel', pos: { x: 0, y: 0 } },
				{ assetId: 'crate', pos: { x: 5, y: 5 } },
				{ assetId: 'crate', pos: { x: 6, y: 5 } }
			]
		};
		expect(plan(view, m, { x: 0, y: 0 }).map((p) => `${p.kind} ${p.id} ${p.priority}`)).toEqual([
			`decoders ${m.decoders!.basis.dir} high`,
			'preview crate high',
			'model barrel low',
			'model crate low'
		]);
		expect(plan(view, manifest, null).some((p) => p.kind === 'decoders')).toBe(false);
	});

	it('reads nothing of the viewer’s snapshot but its environment, tokens and props', () => {
		const read = new Set<string>();
		for (const v of views) {
			// The whole render input a viewer is sent, watched for what the planner reads.
			const watched = new Proxy(v.player as unknown as Record<string, unknown>, {
				get: (target, key) => (read.add(String(key)), Reflect.get(target, key))
			});
			plan(watched as unknown as PlanView, manifest, { x: 0, y: 0 });
		}
		expect([...read].sort()).toEqual(['environment', 'props', 'tokens']);
		expect(plan).toHaveLength(3); // the snapshot, the manifest and the camera's focus
	});

	it('never names an asset the viewer was not sent', () => {
		for (const v of views)
			for (const viewer of ['gm', 'player', 'spectator'] as const) {
				const own = sent(v[viewer]);
				for (const id of ids(v[viewer])) expect(own, `${v.name} ${viewer}`).toContain(id);
				// What only the GM was sent (fogged or hidden) is in no one else's plan.
				if (viewer === 'gm') continue;
				const gmOnly = [...sent(v.gm)].filter((id) => !own.has(id));
				for (const id of gmOnly) expect(ids(v[viewer]), `${v.name} ${viewer}`).not.toContain(id);
			}
	});

	it('leaves a GM-hidden prop out of a player’s plan', () => {
		const { scene, sidecar } = testWorld();
		// The altar stands in plain sight of the player: hidden, only the GM is sent it.
		const hidden = {
			...scene,
			props: scene.props.map((p) => (p.id === 'tw-altar' ? { ...p, hidden: true as const } : p))
		};
		const shown = fixtureViews('test-world', scene, sidecar, 'day') as Record<Viewer, PlanView>;
		const secret = fixtureViews('test-world', hidden, sidecar, 'day') as Record<Viewer, PlanView>;
		expect(ids(shown.player)).toContain('altar');
		expect(ids(secret.gm)).toContain('altar');
		expect(ids(secret.player)).not.toContain('altar');
		expect(ids(secret.spectator)).not.toContain('altar');
	});
});
