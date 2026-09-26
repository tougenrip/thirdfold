// The test world: one small table with a bit of everything the renderer draws,
// the only table the perf scripts measure (scripts/perf-client.mjs,
// scripts/perf-gpu.mjs), so a run takes minutes. At dusk, the costliest hour:
// the sun casts, the darkness overlay is on, flames flicker and mist drifts.
// A stone hall (walls, a door, a window, furniture, sconces and a brazier), a
// platform three levels up a stair behind a railing, a dark corner with its
// own torch, a pond, trees and paths, and eight figures of every kind.

import type { Light } from '../../src/lib/game/lights';
import type { Prop } from '../../src/lib/game/props';
import { light, prop, stair, wall, window } from '../adventure/tables';
import {
	build,
	CHARACTERS,
	ENEMIES,
	grid,
	mini,
	NPCS,
	room,
	sidecar,
	type Fixture
} from './compositions';

export function testWorld(): Fixture {
	const g = grid(24, 24);
	const props: Prop[] = [
		prop('tw-altar', 'altar', 6, 3),
		prop('tw-pew-a', 'pew', 4, 6),
		prop('tw-pew-b', 'pew', 8, 6),
		prop('tw-pillar', 'pillar', 3, 3),
		prop('tw-bookshelf', 'bookshelf', 10, 3),
		prop('tw-sconce-w', 'sconce', 2, 8),
		prop('tw-sconce-e', 'sconce', 11, 8),
		prop('tw-brazier', 'brazier', 18, 5),
		prop('tw-crate', 'crate', 16, 4),
		prop('tw-barrel', 'barrel', 20, 7),
		prop('tw-dark-sconce', 'sconce', 3, 14),
		prop('tw-dark-chest', 'chest', 7, 18),
		prop('tw-well', 'well', 12, 13),
		...[
			[1, 11],
			[10, 21],
			[14, 20],
			[22, 12],
			[21, 22],
			[22, 1]
		].map(([x, y], i) => prop(`tw-tree-${i + 1}`, 'tree', x, y))
	];
	const lights: Light[] = [
		light('tw-sconce-w-light', 2, 8, 4, '#ff9a3c'),
		light('tw-sconce-e-light', 11, 8, 4, '#ff9a3c'),
		light('tw-brazier-light', 18, 5, 5, '#ff8a30'),
		light('tw-dark-light', 3, 14, 3, '#ffb060'),
		light('tw-lamp', 13, 16, 4, '#ffd9a0')
	];
	const models = [...CHARACTERS, ...NPCS.slice(0, 2), ...ENEMIES.slice(0, 2)];
	const spots = [
		[6, 7],
		[7, 7],
		[17, 6],
		[5, 16],
		[13, 11],
		[15, 17],
		[19, 4],
		[9, 12]
	];
	const tokens = models.map((model, i) =>
		mini(`tw-mini-${i + 1}`, model, spots[i][0], spots[i][1], model, i)
	);
	return build(
		{
			name: 'Fixture: test world',
			grid: g,
			environment: 'stone-halls',
			ambient: 'dusk',
			objects: [
				// The hall, its north side a window between two walls.
				...room('tw-hall', { x: 2, y: 2 }, { x: 11, y: 9 }, [
					{ a: { x: 12, y: 5 }, b: { x: 12, y: 6 } }
				]).filter((o) => o.id !== 'tw-hall-wall-n'),
				wall('tw-hall-wall-nw', { x: 2, y: 2 }, { x: 5, y: 2 }),
				window('tw-hall-window', { x: 5, y: 2 }, { x: 8, y: 2 }),
				wall('tw-hall-wall-ne', { x: 8, y: 2 }, { x: 12, y: 2 }),
				// The platform's railing, see-through.
				window('tw-railing', { x: 15, y: 9 }, { x: 22, y: 9 })
			],
			props,
			lights,
			tokens,
			terrain: [
				...stair(0, [
					{ from: { x: 13, y: 6 }, to: { x: 13, y: 7 } },
					{ from: { x: 14, y: 6 }, to: { x: 14, y: 7 } }
				]),
				{ from: { x: 15, y: 3 }, to: { x: 21, y: 8 }, level: 3 }
			],
			dark: [{ from: { x: 1, y: 13 }, to: { x: 8, y: 20 } }],
			floors: [
				{ from: { x: 0, y: 0 }, to: { x: 23, y: 23 }, floor: 'grass' },
				{ from: { x: 12, y: 0 }, to: { x: 13, y: 23 }, floor: 'dirt' },
				{ from: { x: 0, y: 11 }, to: { x: 23, y: 12 }, floor: 'dirt' },
				{ from: { x: 2, y: 2 }, to: { x: 11, y: 9 }, floor: 'stone' },
				{ from: { x: 15, y: 3 }, to: { x: 21, y: 8 }, floor: 'wood' },
				{ from: { x: 16, y: 15 }, to: { x: 21, y: 21 }, floor: 'water' }
			]
		},
		sidecar(g, 'dusk', 'tw-mini-1', { x: 6, y: 7 })
	);
}
