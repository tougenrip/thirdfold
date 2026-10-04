// Measures the world's shape (#239) in Node: classifying a table (the
// continued maps, dual tiles, edge classes and wall spans), finding its
// regions, the dual cases of every tile for the walkable mask and each level
// band, the dirty chunks after a one-cell edit, the ground's chunk meshes
// (#240: the chunk that edit rebuilds, the slowest one, all), on 64x64 and
// 100x100 tables with fog, and picking a cell with the DDA (#246) over every
// pixel of a 160x100 view from above the table's corner. docs/PERFORMANCE.md
// records the numbers.
//
//   npx tsx server/perf/world-shape.ts [runs]

import { performance } from 'node:perf_hooks';
import { VOID } from '../../src/lib/game/floor';
import type { SceneObject } from '../../src/lib/game/objects';
import { dualCase } from '../../src/lib/tabletop/world/dual';
import { pickCell } from '../../src/lib/tabletop/world/pick';
import { regionsOf } from '../../src/lib/tabletop/world/regions';
import { chunkGround } from '../../src/lib/tabletop/world/ground-mesh';
import {
	chunksAcross,
	dirtyChunks,
	worldShape,
	type ShapeInput
} from '../../src/lib/tabletop/world/shape';

const RUNS = Number(process.argv[2] ?? 50);

/** A busy table: terraces, stairs, void and water patches, walls, two thirds explored. */
function table(size: number): ShapeInput {
	let seed = size;
	const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
	const int = (n: number) => Math.floor(rnd() * n);
	const levels = new Uint8Array(size * size);
	const floor = new Uint8Array(size * size);
	const known = new Uint8Array(size * size);
	for (let r = 0; r < size; r++) {
		const [x0, y0, w, h, l] = [int(size), int(size), 2 + int(10), 2 + int(10), int(8)];
		for (let y = y0; y < Math.min(y0 + h, size); y++)
			for (let x = x0; x < Math.min(x0 + w, size); x++) levels[y * size + x] = l;
	}
	for (let r = 0; r < size / 4; r++) {
		const [x0, y0, f] = [int(size - 4), int(size - 4), [VOID, 6, 1][int(3)]];
		for (let y = y0; y < y0 + 4; y++) for (let x = x0; x < x0 + 4; x++) floor[y * size + x] = f;
	}
	for (let i = 0; i < known.length; i++) known[i] = i % size < (size * 2) / 3 ? 1 : 0;
	const objects: SceneObject[] = Array.from({ length: size }, (_, k) => ({
		id: `w${k}`,
		kind: 'wall',
		a: { x: int(size - 6), y: 1 + int(size - 1) },
		b: { x: 0, y: 0 }
	})).map((o) => ({ ...o, b: { x: o.a.x + 5, y: o.a.y } }) as SceneObject);
	return {
		grid: { kind: 'square', cellSize: 1, width: size, height: size },
		levels,
		floor,
		objects,
		known
	};
}

const PICKS = 160 * 100;

/** Picks every pixel of a 160x100 view at 45 degrees from above a corner, looking across the table. */
function picks(shape: ReturnType<typeof worldShape>): void {
	const { grid, ground } = shape;
	const heightAt = (x: number, y: number) => ground.floorY({ x, y });
	const o = { x: -grid.width / 2, y: grid.width / 2, z: -grid.height / 2 };
	for (let j = 0; j < 100; j++)
		for (let i = 0; i < 160; i++) {
			const d = { x: 0.3 + i / 200, y: -0.3 - j / 200, z: 0.3 + (160 - i) / 200 };
			pickCell(grid, heightAt, o, d);
		}
}

function median(f: () => void): number {
	for (let k = 0; k < 5; k++) f();
	const times = Array.from({ length: RUNS }, () => {
		const start = performance.now();
		f();
		return performance.now() - start;
	}).sort((a, b) => a - b);
	return times[Math.floor(RUNS / 2)];
}

for (const size of [64, 100]) {
	const input = table(size);
	const shape = worldShape(input);
	const top = shape.levels.reduce((m, l) => Math.max(m, l), 0);
	const edited = { ...input, levels: input.levels!.slice() };
	edited.levels[10 * size + 10] += 1;
	const next = worldShape(edited);
	const across = chunksAcross(shape.grid);
	const chunks = across.x * across.y;
	const rows = {
		classify: median(() => worldShape(input)),
		regions: median(() => regionsOf(shape)),
		'dual cases (walkable + every band)': median(() => {
			for (let ty = 0; ty <= size; ty++)
				for (let tx = 0; tx <= size; tx++) {
					dualCase(shape, tx, ty, 'walkable');
					for (let l = 1; l <= top; l++) dualCase(shape, tx, ty, l);
				}
		}),
		'dirty chunks (one cell)': median(() => dirtyChunks(shape, next)),
		'pick a cell (DDA, per pick)': median(() => picks(shape)) / PICKS,
		// The ground's meshes (#240): the chunk a one-cell edit rebuilds, the slowest chunk, all.
		'ground mesh, one chunk (one cell)': median(() => {
			for (const c of dirtyChunks(shape, next)) chunkGround(next, c);
		}),
		'ground mesh, slowest chunk': Math.max(
			...Array.from({ length: chunks }, (_, c) => median(() => chunkGround(shape, c)))
		),
		'ground mesh, whole table': median(() => {
			for (let c = 0; c < chunks; c++) chunkGround(shape, c);
		})
	};
	console.log(`${size}x${size} (${top} levels, median of ${RUNS})`);
	for (const [name, ms] of Object.entries(rows))
		console.log(`  ${name.padEnd(36)} ${ms.toFixed(ms < 0.01 ? 4 : 3)} ms`);
}
