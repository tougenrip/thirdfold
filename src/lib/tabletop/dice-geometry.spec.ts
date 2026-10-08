import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { DIE_LABELS } from './dice-faces';
import {
	ATLAS_GRID,
	atlasCell,
	buildDieModel,
	cellText,
	CELL_FILL,
	d4Cells,
	faceInCell,
	GLYPH_RADIUS
} from './dice-geometry';
import type { DieKind } from './dice-throw';

const KINDS: DieKind[] = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100tens', 'd100units'];

describe('the numeral atlas (#275)', () => {
	it.each(KINDS)("puts each %s face's UVs in its label's cell, unmirrored", (kind) => {
		const model = buildDieModel(kind, 1);
		const uv = model.geometry.getAttribute('uv') as THREE.BufferAttribute;
		expect(model.faces).toHaveLength(DIE_LABELS[kind].length);
		model.faces.forEach((face, i) => {
			const cell = atlasCell(kind, i);
			const [col, row] = [cell % ATLAS_GRID, Math.floor(cell / ATLAS_GRID)];
			// The cell's bounds in UV, v up (row 0 at the image's top), less the filtering margin.
			const margin = (0.5 - CELL_FILL) / ATLAS_GRID - 1e-6;
			const [u0, u1] = [col / ATLAS_GRID + margin, (col + 1) / ATLAS_GRID - margin];
			const [v0, v1] = [1 - (row + 1) / ATLAS_GRID + margin, 1 - row / ATLAS_GRID - margin];
			for (const first of face.triangles) {
				const corners = [0, 1, 2].map((k) =>
					new THREE.Vector2().fromBufferAttribute(uv, first + k)
				);
				for (const c of corners) {
					expect(c.x, `${kind} face ${i}`).toBeGreaterThanOrEqual(u0);
					expect(c.x).toBeLessThanOrEqual(u1);
					expect(c.y).toBeGreaterThanOrEqual(v0);
					expect(c.y).toBeLessThanOrEqual(v1);
				}
				// Wound counter-clockwise in UV as in 3D from outside: the numeral reads, not mirrored.
				const [a, b, c] = corners;
				expect((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)).toBeGreaterThan(0);
			}
		});
	});

	it.each(KINDS.filter((k) => k !== 'd4' && k !== 'd6'))(
		"labels each %s face's cell with its number, whose circle fits on the face",
		(kind) => {
			const model = buildDieModel(kind, 1);
			DIE_LABELS[kind].forEach((label, i) => {
				const cell = atlasCell(kind, i);
				expect(cell).toBeLessThan(31);
				expect(cellText(cell).replace('.', '')).toBe(label);
				// The numeral, drawn within GLYPH_RADIUS of the centre, stays inside the face's polygon.
				const corners = faceInCell(kind, model, i).corners;
				const ring = [...corners].sort((a, b) => Math.atan2(a[1], a[0]) - Math.atan2(b[1], b[0]));
				ring.forEach(([ax, ay], k) => {
					const [bx, by] = ring[(k + 1) % ring.length];
					const distance = Math.abs(ax * by - ay * bx) / Math.hypot(bx - ax, by - ay);
					expect(distance).toBeGreaterThanOrEqual(GLYPH_RADIUS * 0.75);
				});
			});
		}
	);

	it('dots the 6 and the 9, and gives the d6 pips and the d4 its own cells', () => {
		expect([cellText(5), cellText(8), cellText(15), cellText(20), cellText(30)]).toEqual([
			'6.',
			'9.',
			'16',
			'0',
			'90'
		]);
		expect(DIE_LABELS.d6.map((_, i) => atlasCell('d6', i))).toEqual([31, 32, 33, 34, 35, 36]);
		expect(DIE_LABELS.d4.map((_, i) => atlasCell('d4', i))).toEqual([37, 38, 39, 40]);
		const all = KINDS.flatMap((k) => DIE_LABELS[k].map((_, i) => atlasCell(k, i)));
		expect(Math.max(...all)).toBeLessThan(ATLAS_GRID * ATLAS_GRID);
	});

	it("draws each d4 face's corners with the number of the vertex there, its lowest on top", () => {
		const model = buildDieModel('d4', 1);
		const cells = d4Cells();
		cells.forEach((marks, face) => {
			// A face shows every number but its own (its own is the vertex opposite it).
			expect(marks.map((m) => m.label).sort()).toEqual(DIE_LABELS.d4.filter((_, k) => k !== face));
			const top = marks.reduce((a, b) => (b.at[1] > a.at[1] ? b : a));
			expect(top.label).toBe(marks.map((m) => m.label).sort()[0]);
			expect(top.at[0]).toBeCloseTo(0, 6);
			for (const m of marks) expect(Math.max(...m.at.map(Math.abs))).toBeLessThanOrEqual(CELL_FILL);
			// The corner each label is drawn at is the corner the UVs put that vertex at.
			const cell = atlasCell('d4', face);
			const uv = model.geometry.getAttribute('uv');
			const pos = model.geometry.getAttribute('position');
			for (const first of model.faces[face].triangles)
				for (let v = first; v < first + 3; v++) {
					const p = new THREE.Vector3().fromBufferAttribute(pos, v);
					const apex = model.apexes!.findIndex((a) => a.distanceTo(p) < 1e-4);
					const mark = marks.find((m) => m.label === DIE_LABELS.d4[apex])!;
					const [col, row] = [cell % ATLAS_GRID, Math.floor(cell / ATLAS_GRID)];
					expect(uv.getX(v)).toBeCloseTo((col + 0.5 + mark.at[0]) / ATLAS_GRID, 6);
					expect(uv.getY(v)).toBeCloseTo(1 - (row + 0.5 - mark.at[1]) / ATLAS_GRID, 6);
				}
		});
	});
});
