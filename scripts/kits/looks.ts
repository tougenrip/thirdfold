// Each built-in environment's greybox kit (#261): its colours, walls, boundary, bridge deck,
// floor tiles and the roles only it has. scripts/make-kits.ts writes them.

import { cobbleTiles, flagTiles, gratingTile, plankTiles, type Style } from './pieces';
import { ball, boards, box, cone, courses, cyl, pointed, rubble, type Part } from './parts';

const palisade = (logs: string[], tip: string): Part[] => [
	...[-0.4, -0.2, 0, 0.2, 0.4].flatMap((x, i) => [
		cyl(
			[0.19, 1.7 - (i % 2) * 0.12, 0.19],
			[x, 0.85 - (i % 2) * 0.06, 0.03],
			logs[i % logs.length]
		),
		cone([0.19, 0.28, 0.19], [x, 1.84 - (i % 2) * 0.12, 0.03], tip)
	]),
	box([1, 0.1, 0.06], [0, 1.2, 0.16], logs[0]),
	box([1, 0.1, 0.06], [0, 0.45, 0.16], logs[0])
];

const plankDeck = (s: Style): Part[] => [
	...[-0.4, -0.2, 0, 0.2, 0.4].map((x, i) =>
		box([0.19, 0.07, 1], [x, -0.035, 0], i % 2 ? s.door : s.trim)
	),
	...[-1, 1].map((z) => box([1, 0.22, 0.1], [0, -0.18, z * 0.35], s.dark))
];
const stoneDeck = (s: Style): Part[] => [
	box([1, 0.3, 1], [0, -0.15, 0], s.base),
	...[-1, 1].map((z) => box([1, 0.08, 0.12], [0, -0.04, z * 0.44], s.dark))
];

export const village: Style = {
	id: 'village',
	name: 'Village',
	wall: 'plaster',
	dark: '#4f3b30',
	trim: '#5f4533',
	base: '#7e7b72',
	door: '#86623f',
	iron: '#3d4250',
	glass: '#5d6a78',
	roof: { style: 'gable', pitch: 45, eave: 0.25, material: 'thatch' },
	presumeRoofs: true,
	ridge: '#6a5a3d',
	walls: (s) => [
		{
			id: 'wall-plaster',
			parts: [box([1, 2, 0.12], [0, 1, 0], s.wall), box([1, 0.3, 0.14], [0, 0.15, 0], s.base)]
		},
		{
			id: 'wall-timber',
			parts: [
				box([1, 2, 0.1], [0, 1, 0], s.wall),
				box([1, 0.3, 0.14], [0, 0.15, 0], s.base),
				...[-1, 1].map((x) => box([0.12, 1.7, 0.14], [x * 0.44, 1.15, 0], s.dark)),
				box([1, 0.1, 0.14], [0, 1.05, 0], s.dark),
				box([1, 0.12, 0.14], [0, 1.94, 0], s.dark),
				box([0.09, 0.9, 0.13], [0.05, 1.52, 0], s.trim, [0, 0, 0.55]),
				box([0.09, 0.75, 0.13], [-0.1, 0.65, 0], s.trim, [0, 0, -0.5])
			],
			weight: 0.7
		}
	],
	boundary: () => palisade(['#6d5441', '#4d3a30'], '#8e7355'),
	deck: plankDeck,
	floors: (s) => ({
		cobble: cobbleTiles('cobble', ['#7e7b72', '#585a5f', '#a39d8a']),
		wood: plankTiles('planks', [s.door, s.trim, '#aa8656'])
	})
};

export const stoneHalls: Style = {
	id: 'stone-halls',
	// The pilot kit (#263, scripts/make-stone-halls-art.ts) is stone-halls.json; this is its fallback.
	kit: 'stone-halls-greybox',
	name: 'Stone halls (greybox)',
	wall: 'monastery-stone',
	dark: '#6f6c6a',
	trim: '#948d7f',
	base: '#b8ae98',
	door: '#5f4533',
	iron: '#3d4250',
	glass: '#4d5a6b',
	gothic: true,
	roof: { style: 'gable', pitch: 40, eave: 0.2, material: 'slate' },
	ridge: '#6f6c6a',
	walls: (s) => [
		{
			id: 'wall-ashlar-a',
			parts: [box([1, 2, 0.1], [0, 1, 0], s.dark), ...courses(0, 2, 5, 0.14, s.wall, 41)]
		},
		{
			id: 'wall-ashlar-b',
			parts: [
				box([1, 2, 0.1], [0, 1, 0], s.dark),
				...courses(0, 1.2, 3, 0.13, s.wall, 42),
				box([1, 0.1, 0.14], [0, 1.25, 0], s.base),
				...courses(1.3, 2, 2, 0.13, s.wall, 43)
			],
			weight: 0.6
		}
	],
	boundary: (s) => [
		box([1, 1.5, 0.34], [0, 0.75, 0.1], s.wall),
		box([1, 0.1, 0.38], [0, 1.55, 0.12], s.base),
		...[-1, 1].map((x) => box([0.38, 0.4, 0.3], [x * 0.3, 1.8, 0.11], s.wall))
	],
	deck: stoneDeck,
	floors: (s) => {
		const flags = flagTiles('flag', ['#86826f', '#aca58d', '#5f5f63']);
		return {
			plain: flags,
			flagstone: flags,
			stone: flags,
			wood: plankTiles('planks', [s.door, '#856342', '#3a2b2b']),
			tile: flagTiles('tile', ['#93493a', '#b0714c', '#86826f'])
		};
	},
	more: (s) => ({
		'cap.battlement': [
			{
				id: 'battlement',
				parts: [
					box([1, 0.1, 0.3], [0, 1.5, 0.13], s.base),
					...[-0.35, 0, 0.35].map((x) => box([0.12, 0.08, 0.26], [x, 1.5, 0.15], s.dark)),
					box([1, 0.25, 0.14], [0, 1.67, 0.21], s.wall),
					...[-1, 1].map((x) => box([0.36, 0.2, 0.14], [x * 0.3, 1.9, 0.21], s.wall))
				]
			}
		],
		crenellation: [
			{
				id: 'crenels',
				parts: [-1, 1].map((x) => box([0.36, 0.34, 0.14], [x * 0.25, 1.83, 0], s.wall))
			}
		],
		buttress: [
			{
				id: 'buttress',
				parts: [
					box([0.2, 1.2, 0.4], [0, 0.6, 0.1], s.wall),
					box([0.2, 0.7, 0.25], [0, 1.55, 0.025], s.wall),
					box([0.2, 0.06, 0.4], [0, 1.2, 0.1], s.base)
				]
			}
		],
		pinnacle: [
			{
				id: 'pinnacle',
				parts: [
					box([0.3, 0.25, 0.3], [0, 1.625, 0], s.base),
					cone([0.26, 0.4, 0.26], [0, 1.95, 0], s.wall)
				]
			}
		],
		'tower.corner': [
			{
				id: 'tower-corner',
				parts: [
					cyl([0.86, 2, 0.86], [0.47, 1, 0.47], s.wall),
					cyl([0.94, 0.14, 0.94], [0.47, 2.07, 0.47], s.base),
					cyl([0.9, 0.1, 0.9], [0.47, 0.05, 0.47], s.base)
				]
			}
		],
		arch: [{ id: 'arch', parts: archParts(s) }]
	})
};

function archParts(s: Style): Part[] {
	return [
		...[-1, 1].map((x) => box([0.16, 1.5, 0.12], [x * 0.42, 0.75, 0], s.wall)),
		...pointed(0.42, 1.6, 0.44, 0.7, s.trim),
		box([1, 0.25, 0.12], [0, 1.875, 0], s.wall)
	];
}

export const cavern: Style = {
	id: 'cavern',
	name: 'Cavern',
	wall: 'ancient-stone',
	dark: '#3f3e46',
	trim: '#7a766c',
	base: 'cave-rock',
	door: '#4d3a30',
	iron: '#30323d',
	glass: '#25252f',
	walls: (s) => [
		{
			id: 'wall-rough',
			parts: [
				box([1, 2, 0.08], [0, 1, 0], s.dark),
				...rubble(0, 2, -0.068, 0.068, [s.base, '#52535a', '#5f5a55'], 51, 5)
			]
		},
		{
			id: 'wall-ancient',
			parts: [box([1, 2, 0.1], [0, 1, 0], s.dark), ...courses(0, 2, 4, 0.14, s.wall, 52)],
			weight: 0.6
		}
	],
	boundary: (s) => rubble(0, 1.4, -0.068, 0.3, [s.base, '#52535a'], 53, 3),
	deck: stoneDeck,
	floors: () => ({ stone: flagTiles('hewn', ['#7a766c', '#52535a', '#5f5a55']) }),
	more: (s) => ({ arch: [{ id: 'arch', parts: archParts(s) }] })
};

export const livingCave: Style = {
	id: 'living-cave',
	name: 'Living cave',
	wall: 'sinew',
	dark: '#4a1c22',
	trim: '#7a3a3a',
	base: '#5a2a2e',
	door: '#6b3a33',
	iron: '#2c2527',
	glass: '#3a1a24',
	walls: (s) => [
		{
			id: 'wall-sinew',
			parts: [
				box([1, 2, 0.1], [0, 1, 0], s.wall),
				...[-0.3, 0.05, 0.35].map((x, i) =>
					cyl([0.1, 1.9, 0.13], [x, 0.95, 0], i % 2 ? s.trim : s.dark)
				)
			]
		},
		{
			id: 'wall-swollen',
			parts: [
				box([1, 2, 0.1], [0, 1, 0], s.wall),
				ball([0.4, 0.5, 0.14], [-0.2, 0.7, 0], s.base),
				ball([0.32, 0.42, 0.14], [0.25, 1.4, 0], s.base),
				cyl([0.1, 1.9, 0.13], [0.42, 0.95, 0], s.dark)
			],
			weight: 0.6
		}
	],
	boundary: (s) => [
		...[-0.35, 0, 0.35].map((x, i) =>
			cyl([0.2, 1.6 + i * 0.1, 0.2], [x, 0.8 + i * 0.05, 0.08], i % 2 ? s.trim : s.dark)
		),
		box([1, 0.9, 0.06], [0, 0.6, 0.08], s.wall)
	],
	deck: (s) => [
		box([1, 0.22, 1], [0, -0.11, 0], s.wall),
		...[-0.3, 0.05, 0.35].map((x) => box([0.12, 0.3, 1], [x, -0.15, 0], s.dark))
	]
};

export const railcar: Style = {
	id: 'railcar',
	name: 'Railcar',
	wall: 'railcar-wall',
	dark: '#3a2b2b',
	trim: '#5f4533',
	base: '#3a2b2b',
	door: '#856342',
	iron: '#3d4250',
	glass: '#5d6a78',
	roof: { style: 'gable', pitch: 15, eave: 0.12, material: 'tin-roof' },
	presumeRoofs: true,
	ridge: '#3d4250',
	walls: (s) => [
		{
			id: 'wall-panelled',
			parts: [
				box([1, 2, 0.1], [0, 1, 0], s.wall),
				...boards(0, 0.9, 5, 0.14, s.trim, s.dark),
				box([1, 0.06, 0.14], [0, 0.93, 0], '#a7855a')
			]
		},
		{
			id: 'wall-boarded',
			parts: [box([1, 2, 0.1], [0, 1, 0], s.wall), ...boards(0, 2, 6, 0.14, s.wall, s.trim)],
			weight: 0.5
		}
	],
	boundary: (s) => [
		...[-0.45, 0, 0.45].map((x) => box([0.06, 1.1, 0.06], [x, 0.55, 0.03], s.iron)),
		box([1, 0.05, 0.06], [0, 1.07, 0.03], '#a7855a'),
		box([1, 0.04, 0.05], [0, 0.6, 0.03], s.iron)
	],
	deck: plankDeck,
	floors: () => {
		const planks = plankTiles('planks', ['#856342', '#5f4533', '#a7855a']);
		return {
			plain: planks,
			wood: planks,
			grating: { tiles: [gratingTile('grating-a', '#3d4250', '#30323d')], broken: [] }
		};
	}
};

export const ghostTown: Style = {
	id: 'ghost-town',
	name: 'Ghost town',
	wall: '#b0835d',
	dark: '#5a4040',
	trim: 'weathered-wood',
	base: '#8a5f48',
	door: '#6d6152',
	iron: '#3a3438',
	glass: '#3b3c44',
	roof: { style: 'gable', pitch: 22, eave: 0.2, material: 'roof-boards' },
	presumeRoofs: true,
	ridge: '#5a4a3e',
	walls: (s) => [
		{
			id: 'wall-adobe',
			parts: [
				box([1, 2, 0.12], [0, 1, 0], s.wall),
				box([1, 0.35, 0.14], [0, 0.175, 0], s.base),
				box([1, 0.1, 0.14], [0, 1.95, 0], '#cfa77c')
			]
		},
		{
			id: 'wall-boards',
			parts: [box([1, 2, 0.08], [0, 1, 0], s.dark), ...boards(0, 2, 5, 0.14, s.trim, s.door)],
			weight: 0.8
		}
	],
	boundary: (s) => [
		...[-0.4, -0.2, 0, 0.2, 0.4].map((x, i) =>
			box([0.12, 1.1 - (i % 2) * 0.1, 0.04], [x, 0.55 - (i % 2) * 0.05, 0.03], s.trim)
		),
		box([1, 0.08, 0.04], [0, 0.8, 0.075], s.door),
		box([1, 0.08, 0.04], [0, 0.3, 0.075], s.door)
	],
	deck: plankDeck,
	floors: (s) => ({ wood: plankTiles('boardwalk', [s.door, '#8a7b66', '#5a4a3e']) })
};

export const STYLES: Style[] = [village, stoneHalls, cavern, livingCave, railcar, ghostTown];
