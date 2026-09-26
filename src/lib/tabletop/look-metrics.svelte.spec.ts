// Measures how close today's renders are to the reference shots (docs/LOOK.md)
// and records it in docs/look-metrics.json, keyed by milestone. The reference
// images are private: they are read from .look-refs/ (gitignored, filled by
// scripts/look-metrics.mjs from $LOOK_REFS) and only their numbers are
// committed. Without them the committed reference numbers are used, so anyone
// can measure a render; with neither, this skips.
//   node scripts/look-metrics.mjs [--ours-only]

import { commands } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { distance, lookMetrics, WEIGHTS, WEIGHTS_VERSION, type LookMetrics } from './look-metrics';
import {
	loadSidecar,
	loadView,
	manualClock,
	mountFixture,
	settle,
	HEIGHT,
	WIDTH,
	type Band,
	type PoseName
} from './testing';

vi.setConfig({ testTimeout: 120_000 });

const OUT = 'docs/look-metrics.json';
/** Set by scripts/look-metrics.mjs; without it (a plain `npm test`) nothing is measured. */
const MILESTONE = import.meta.env.VITE_LOOK_MILESTONE as string | undefined;
const OURS_ONLY = import.meta.env.VITE_LOOK_OURS_ONLY === '1';

interface Pairing {
	reference: number;
	fixture: string;
	pose: PoseName;
	band: Band;
	/** The rows (fractions of the height from the top) that are the horizon in the reference. */
	horizon: [number, number];
}

/** Which render stands for which reference: see docs/LOOK.md. */
export const PAIRINGS: Pairing[] = [
	{ reference: 1, fixture: 'ref-1', pose: 'close', band: 'dark', horizon: [0.02, 0.1] },
	{ reference: 2, fixture: 'monastery', pose: 'overview', band: 'dusk', horizon: [0.02, 0.1] },
	{ reference: 3, fixture: 'ref-3', pose: 'close', band: 'dark', horizon: [0.02, 0.1] },
	{ reference: 4, fixture: 'dungeon-40', pose: 'overview', band: 'dark', horizon: [0.02, 0.1] },
	{ reference: 6, fixture: 'ref-6', pose: 'close', band: 'dark', horizon: [0.05, 0.2] },
	{ reference: 7, fixture: 'ref-7', pose: 'close', band: 'day', horizon: [0.02, 0.1] },
	{ reference: 8, fixture: 'ref-8', pose: 'overview', band: 'dusk', horizon: [0.1, 0.22] }
];

interface Entry extends Pairing {
	referenceMetrics: LookMetrics;
	ours: Record<string, { metrics: LookMetrics; distance: number }>;
}

interface Report {
	weightsVersion: number;
	weights: typeof WEIGHTS;
	pairings: Record<string, Entry>;
}

async function readJson<T>(path: string): Promise<T | null> {
	try {
		return JSON.parse(await commands.readFile(path)) as T;
	} catch {
		return null;
	}
}

/** A reference's pixels, or null when the private images are not here. */
async function readReference(n: number) {
	if (OURS_ONLY) return null;
	let base64: string;
	try {
		base64 = await commands.readFile(`.look-refs/${n}.jpg`, 'base64');
	} catch {
		return null;
	}
	const blob = await (await fetch(`data:image/jpeg;base64,${base64}`)).blob();
	const bitmap = await createImageBitmap(blob);
	const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
	const ctx = canvas.getContext('2d')!;
	ctx.drawImage(bitmap, 0, 0);
	const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
	return { data, width: bitmap.width, height: bitmap.height };
}

/** Our render at the pairing's pose: the GM's view, without the fog overlay (references show none). */
async function renderOurs(p: Pairing) {
	const sidecar = await loadSidecar(p.fixture);
	const view = structuredClone(await loadView(p.fixture, p.band, 'gm'));
	view.fog = { ...view.fog, enabled: false };
	const m = await mountFixture(view, sidecar.poses[p.pose], { clock: manualClock(5000) });
	await settle(m.tabletop);
	const pixels = m.pixels();
	m.unmount();
	return { data: pixels, width: WIDTH, height: HEIGHT };
}

describe('look metrics against the references', async () => {
	const committed = await readJson<Report>(OUT);
	const anyRefs = (await readReference(1)) !== null;
	const usable = !!MILESTONE && (anyRefs || !!committed);

	it.skipIf(!usable)(`measures ${MILESTONE} and records it in ${OUT}`, async () => {
		const report: Report = {
			weightsVersion: WEIGHTS_VERSION,
			weights: WEIGHTS,
			pairings: committed?.weightsVersion === WEIGHTS_VERSION ? committed.pairings : {}
		};
		for (const p of PAIRINGS) {
			const key = `ref-${p.reference}`;
			const image = await readReference(p.reference);
			const referenceMetrics = image
				? lookMetrics(image, p.horizon)
				: report.pairings[key]?.referenceMetrics;
			if (!referenceMetrics) continue;
			const metrics = lookMetrics(await renderOurs(p), p.horizon, true);
			report.pairings[key] = {
				...p,
				referenceMetrics,
				ours: {
					...report.pairings[key]?.ours,
					[MILESTONE!]: { metrics, distance: distance(metrics, referenceMetrics) }
				}
			};
		}
		expect(Object.keys(report.pairings).length).toBeGreaterThan(0);
		await commands.writeFile(OUT, JSON.stringify(report, null, '\t') + '\n');
	});
});
