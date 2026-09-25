// Golden images of the renderer (milestone 61, baseline v0): every fixture
// table at its named poses, in each ambient band, for the GM, a fogged player
// and a spectator, drawn with SwiftShader at DPR 1 on an 800x500 canvas with a
// frozen clock and reduced motion. Only Linux references are committed; CI is
// the authority. To update them on purpose (and show before and after in the
// PR, see docs/RENDERING.md):
//   npx vitest run --project client src/lib/tabletop/golden.svelte.spec.ts --update

import { page, server } from 'vitest/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	loadSidecar,
	loadView,
	manualClock,
	mountFixture,
	settle,
	type Band,
	type Mounted,
	type PoseName,
	type Viewer
} from './testing';

vi.setConfig({ testTimeout: 60_000 });

const STORY = ['village', 'monastery', 'hollow', 'heart', 'railcar', 'ghost-town'];
const COMPOSED = ['ref-1', 'ref-3', 'ref-6', 'ref-7', 'ref-8'];
const STRESS = ['dungeon-40', 'outdoor-64', 'crowd-60'];
const BANDS: Band[] = ['day', 'dusk', 'dark'];

interface Shot {
	fixture: string;
	pose: PoseName;
	band: Band | 'own';
	viewer: Viewer;
}

/** Which images are taken: see the table in #132. */
export const MATRIX: Shot[] = [
	...[...STORY, ...COMPOSED].flatMap((fixture): Shot[] => [
		{ fixture, pose: 'overview', band: 'own', viewer: 'gm' },
		{ fixture, pose: 'overview', band: 'own', viewer: 'player' },
		{ fixture, pose: 'overview', band: 'own', viewer: 'spectator' },
		...BANDS.map((band): Shot => ({ fixture, pose: 'overview', band, viewer: 'gm' })),
		{ fixture, pose: 'close', band: 'own', viewer: 'gm' },
		{ fixture, pose: 'close', band: 'own', viewer: 'player' },
		{ fixture, pose: 'low', band: 'own', viewer: 'gm' },
		{ fixture, pose: 'dark', band: 'dark', viewer: 'gm' },
		{ fixture, pose: 'dark', band: 'dark', viewer: 'player' }
	]),
	...STRESS.map((fixture): Shot => ({ fixture, pose: 'overview', band: 'own', viewer: 'gm' }))
];

const linux = server.platform === 'linux';
if (import.meta.env.CI && !linux) throw new Error('Golden images are checked on Linux in CI.');

let mounted: Mounted | null = null;
afterEach(() => {
	mounted?.unmount();
	mounted = null;
});

describe.skipIf(!linux)('golden images', () => {
	const seen = new Set<string>();
	for (const shot of MATRIX) {
		it(`${shot.fixture} ${shot.pose} ${shot.band} ${shot.viewer}`, async () => {
			const sidecar = await loadSidecar(shot.fixture);
			const band = shot.band === 'own' ? sidecar.ambient : shot.band;
			const name = `${shot.fixture}-${shot.pose}-${band}-${shot.viewer}`;
			// "own" can repeat an explicit band: take each image once.
			if (seen.has(name)) return expect(true).toBe(true);
			seen.add(name);
			const view = await loadView(shot.fixture, band, shot.viewer);
			mounted = await mountFixture(view, sidecar.poses[shot.pose], { clock: manualClock(5000) });
			await settle(mounted.tabletop);
			await expect.element(page.elementLocator(mounted.canvas)).toMatchScreenshot(name);
		});
	}
});
