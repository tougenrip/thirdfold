import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeFloor } from '../../src/lib/game/floor';
import { decodeLevels } from '../../src/lib/game/terrain';
import { decodeMask, type FogView } from '../../src/lib/game/visibility';
import { committedFixtures, fixtureFiles } from './build';

const ROOT = path.resolve(import.meta.dirname, '../..');
const fixtures = committedFixtures();
const files = fixtureFiles(fixtures);

interface ViewFile {
	grid: { width: number; height: number };
	fog: FogView;
	terrain: string | null;
	floor: string | null;
	darkness: string | null;
	tokens: { id: string; hidden?: true }[];
	props: { id: string; hidden?: true }[];
}

describe('the per-viewer fixture views', () => {
	it('are committed: tests/fixtures is exactly what the fixtures produce', () => {
		const stale: string[] = [];
		for (const [file, text] of files) {
			let committed = '';
			try {
				committed = readFileSync(path.join(ROOT, file), 'utf8');
			} catch {
				// missing
			}
			if (committed !== text) stale.push(file);
		}
		expect(stale, 'stale fixtures: run `npx tsx server/fixtures/build.ts`').toEqual([]);
	});

	for (const [file, text] of files) {
		if (!file.startsWith('tests/fixtures/views/')) continue;
		it(`${path.basename(file)}: never shows a player or spectator what the rules keep from them`, () => {
			const views = JSON.parse(text) as Record<'gm' | 'player' | 'spectator', ViewFile>;
			const hidden = new Set(
				[...views.gm.tokens, ...views.gm.props].filter((x) => x.hidden).map((x) => x.id)
			);
			for (const role of ['player', 'spectator'] as const) {
				const v = views[role];
				const size = v.grid.width * v.grid.height;
				const sent = [...v.tokens, ...v.props].map((x) => x.id);
				// The fogged player owns a token; a hidden one of theirs is still theirs.
				if (role === 'spectator') for (const id of sent) expect(hidden.has(id), id).toBe(false);
				const explored = decodeMask(v.fog.explored, size);
				const unexplored = (data: Uint8Array | null) =>
					data ? [...data].filter((value, i) => value !== 0 && !explored[i]).length : 0;
				expect(
					unexplored(v.terrain ? decodeLevels(v.terrain, size) : null),
					`${role} terrain`
				).toBe(0);
				expect(unexplored(v.floor ? decodeFloor(v.floor, size) : null), `${role} floor`).toBe(0);
				expect(
					unexplored(v.darkness ? decodeMask(v.darkness, size) : null),
					`${role} darkness`
				).toBe(0);
			}
		});
	}
});
