import { describe, expect, it } from 'vitest';
import { decodeFloor } from '../../src/lib/game/floor';
import { inBounds } from '../../src/lib/game/grid';
import { obstaclesFor, placementProblem } from '../../src/lib/game/props';
import { parseSceneFile, SCENE_FILE_VERSION } from '../../src/lib/game/scene-file';
import { decodeLevels } from '../../src/lib/game/terrain';
import { committedFixtures } from './build';
import { compositions } from './compositions';

const fixtures = committedFixtures();

describe('the fixture tables', () => {
	it('are all committed: five reference compositions, three stress tables, six adventure tables', () => {
		expect(Object.keys(fixtures).sort()).toEqual(
			[
				'crowd-60',
				'dungeon-40',
				'ghost-town',
				'heart',
				'hollow',
				'monastery',
				'outdoor-64',
				'railcar',
				'ref-1',
				'ref-3',
				'ref-6',
				'ref-7',
				'ref-8',
				'village'
			].sort()
		);
	});

	it('are what the compositions build, byte for byte', () => {
		for (const [name, { scene, sidecar }] of Object.entries(compositions())) {
			expect(JSON.stringify(fixtures[name]?.scene), name).toBe(JSON.stringify(scene));
			expect(JSON.stringify(fixtures[name]?.sidecar), name).toBe(JSON.stringify(sidecar));
		}
	});

	for (const [name, { scene, sidecar }] of Object.entries(fixtures)) {
		it(`${name}: loads as a current scene file and makes sense on the grid`, () => {
			const parsed = parseSceneFile(scene);
			expect(parsed.ok, parsed.ok ? '' : parsed.error).toBe(true);
			expect(scene.version).toBe(SCENE_FILE_VERSION);
			for (const list of [scene.tokens, scene.objects, scene.props, scene.lights]) {
				const ids = list.map((x) => x.id);
				expect(new Set(ids).size, name).toBe(ids.length);
			}
			const size = scene.grid.width * scene.grid.height;
			const levels = scene.terrain ? decodeLevels(scene.terrain, size) : null;
			const floor = scene.floor ? decodeFloor(scene.floor, size) : null;
			const { solid } = obstaclesFor(scene.grid, scene.objects, scene.props, levels, floor);
			for (const t of scene.tokens) {
				expect(inBounds(scene.grid, t.pos), `${name} ${t.id}`).toBe(true);
				expect(
					solid?.[t.pos.y * scene.grid.width + t.pos.x] ?? 0,
					`${name} ${t.id} on a solid cell`
				).toBe(0);
			}
			if (name in compositions()) {
				for (const p of scene.props) {
					const others = scene.props.filter((o) => o.id !== p.id);
					expect(
						placementProblem(scene.grid, p, scene.tokens, others, p.id),
						`${name} ${p.id}`
					).toBeNull();
				}
			}
			expect(
				scene.tokens.some((t) => t.id === sidecar.player.tokenId),
				name
			).toBe(true);
			for (const pose of Object.values(sidecar.poses)) {
				expect(inBounds(scene.grid, pose.target), name).toBe(true);
				expect(pose.distance).toBeGreaterThan(0);
			}
		});
	}
});
