import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import type { SquareGrid } from '$lib/game/grid';
import { VOID } from '$lib/game/floor';
import { DiceLayer, diceSurface, throwFromView } from './dice3d';
import { DIE_LABELS } from './dice-faces';
import { DICE_SHOWN } from './materials/dice';
import { buildDieModel } from './dice-geometry';
import { groundFor, STEP_HEIGHT } from './ground';
import type { DieKind } from './dice-throw';

const layer = () => new DiceLayer();

/**
 * The number a player reads on a landed die, by face index: the face whose normal, turned by the
 * die's instance matrix, points up (on a d4, down: it is read at the vertex opposite).
 */
function reading(l: DiceLayer, which = 0): string {
	const { kind, matrix } = l.dice()[which];
	const model = buildDieModel(kind, 1);
	const turn = new THREE.Matrix3().getNormalMatrix(matrix);
	const sign = model.readsAtVertex ? -1 : 1;
	let best = { y: -Infinity, face: -1 };
	model.faces.forEach((f, face) => {
		const y = f.normal.clone().applyMatrix3(turn).normalize().y * sign;
		if (y > best.y) best = { y, face };
	});
	expect(best.y, `${kind} lies flat`).toBeGreaterThan(0.999);
	return DIE_LABELS[kind][best.face];
}

/** Where a die stands: its instance's position. */
const placeOf = (l: DiceLayer, which = 0) =>
	new THREE.Vector3().setFromMatrixPosition(l.dice()[which].matrix);

describe('DiceLayer', () => {
	const kinds: DieKind[] = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100tens', 'd100units'];

	it.each(kinds)('%s lands reading the rolled face, for every face', (kind) => {
		const l = layer();
		DIE_LABELS[kind].forEach((label, face) => {
			const ms = l.throw(
				{ seq: face + 3, dice: [{ kind, face }], color: '#ffffff' },
				{ center: new THREE.Vector3(), from: new THREE.Vector3(0, 2, 4) },
				1,
				false,
				0
			);
			l.tick(ms + 1);
			expect(reading(l)).toBe(label);
		});
	});

	it('keys the animation to the wall clock, not to how many frames were drawn', () => {
		const l = layer();
		const ms = l.throw(
			{ seq: 1, dice: [{ kind: 'd20', face: 19 }], color: '#ffffff' },
			{ center: new THREE.Vector3(), from: new THREE.Vector3(0, 2, 4) },
			1,
			false,
			5000
		);
		l.tick(5000 + ms / 2); // one slow frame mid-flight
		l.tick(5000 + ms + 1); // the next frame, after landing time
		expect(reading(l)).toBe('20');
	});

	it('draws twelve d20s as one mesh, and any mix as a mesh per kind on one material (#275)', () => {
		const l = layer();
		const aim = { center: new THREE.Vector3(), from: new THREE.Vector3(0, 2, 4) };
		const d20s = Array.from({ length: 12 }, (_, i) => ({ kind: 'd20' as const, face: i }));
		l.throw({ seq: 4, dice: d20s, color: '#2050d0' }, aim, 1, true, 0);
		const meshes = () => l.group.children as THREE.InstancedMesh[];
		expect(meshes().map((m) => m.count)).toEqual([12]);
		const all = kinds.map((kind) => ({ kind, face: 0 }));
		l.throw({ seq: 5, dice: all, color: '#2050d0' }, aim, 1, true, 0);
		expect(meshes()).toHaveLength(8);
		expect(meshes().map((m) => m.count)).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
		expect(new Set(meshes().map((m) => m.material)).size).toBe(1);
		// Fading writes the instance attribute; nothing turns transparent.
		l.tick(3_450); // thrown instantly: resting 3.2 s, then half faded
		const fade = meshes()[1].geometry.getAttribute('aDieFade');
		expect(fade.getX(0)).toBeCloseTo(0.5);
		const material = meshes()[0].material as THREE.MeshPhysicalNodeMaterial;
		expect([material.transparent, material.alphaHash]).toEqual([false, true]);
		// Dice show over cells the fog hides: they write "shown" into the hidden attachment.
		expect(material.mrtNode).toBe(DICE_SHOWN);
	});

	it('sweeps earlier dice away on a new throw and clears them after resting', () => {
		const l = layer();
		l.throw(
			{
				seq: 1,
				dice: [
					{ kind: 'd6', face: 0 },
					{ kind: 'd6', face: 1 }
				],
				color: '#fff'
			},
			{ center: new THREE.Vector3(), from: new THREE.Vector3() },
			1,
			false,
			0
		);
		expect(l.dice()).toHaveLength(2);
		l.throw(
			{ seq: 2, dice: [{ kind: 'd8', face: 0 }], color: '#fff' },
			{ center: new THREE.Vector3(), from: new THREE.Vector3() },
			1,
			false,
			0
		);
		expect(l.dice()).toHaveLength(1);
		expect(l.tick(60_000)).toBe(false);
		expect(l.dice()).toHaveLength(0);
	});
});

describe('dice on the ground (#247)', () => {
	const kinds: DieKind[] = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100tens', 'd100units'];
	// A 10x10 table, cells 1 world unit: the east half (x >= 0) raised to level 5, the gallery's
	// height; the west column of cells (x < -4) void.
	const grid: SquareGrid = { kind: 'square', width: 10, height: 10, cellSize: 1 };
	const levels = new Uint8Array(100).map((_, i) => (i % 10 >= 5 ? 5 : 0));
	const floor = new Uint8Array(100).map((_, i) => (i % 10 === 0 ? VOID : 0));
	const ground = groundFor(grid, levels);
	const surface = diceSurface(grid, ground, floor);
	const raised = 5 * STEP_HEIGHT;
	const throwOf = (seq: number, dice: { kind: DieKind; face: number }[]) => ({
		seq,
		dice,
		color: '#ffffff'
	});

	it('lands every die on raised ground at its surface, reading the rolled face', () => {
		const l = layer();
		for (const kind of kinds)
			DIE_LABELS[kind].forEach((label, face) => {
				const center = new THREE.Vector3(2.5, raised, 0.5);
				const from = new THREE.Vector3(2.5, raised + 4, 4.5);
				const ms = l.throw(
					throwOf(face + 7, [{ kind, face }]),
					{ center, from, surface },
					1,
					false,
					0
				);
				l.tick(ms + 1);
				expect(reading(l)).toBe(label);
				const root = placeOf(l);
				expect(surface(root.x, root.z)).toBe(raised);
				expect(root.y).toBeCloseTo(raised + buildDieModel(kind, 1).inradius * 0.9);
			});
	});

	it('pulls dice bound for the void or off the grid in, never landing there', () => {
		const l = layer();
		const dice = Array.from({ length: 12 }, (_, i) => ({ kind: 'd6' as const, face: i % 6 }));
		// Around a cell beside the void column and the table's north edge.
		const center = new THREE.Vector3(-3.5, 0, -4.5);
		for (let seq = 1; seq <= 40; seq++) {
			l.throw(
				throwOf(seq, dice),
				{ center, from: new THREE.Vector3(0, 4, 0), surface },
				1,
				true,
				0
			);
			l.tick(1);
			for (let i = 0; i < l.dice().length; i++) {
				const root = placeOf(l, i);
				const under = surface(root.x, root.z);
				expect(under, `seq ${seq} at ${root.x}, ${root.z}`).not.toBeNull();
				expect(root.y).toBeGreaterThan(under!);
			}
		}
	});

	it('lands the same throw the same way every time', () => {
		const at = () => {
			const l = layer();
			const dice = Array.from({ length: 12 }, () => ({ kind: 'd20' as const, face: 3 }));
			const [center, from] = [new THREE.Vector3(-0.5, 0, 0), new THREE.Vector3(0, 4, 4)];
			l.throw(throwOf(9, dice), { center, from, surface }, 1, true, 0);
			l.tick(1);
			return l.dice().map((_, i) => placeOf(l, i).toArray());
		};
		expect(at()).toEqual(at());
	});

	it('aims at the nearest cell dice may land on when the camera looks past them', () => {
		const camera = new THREE.Vector3(0, 10, 10);
		const off = throwFromView(new THREE.Vector3(-30, 0, 0.2), camera, grid, ground, floor);
		expect([off.center.x, off.center.y, off.center.z]).toEqual([-3.5, 0, 0.5]);
		const balcony = throwFromView(new THREE.Vector3(2.2, 0, 0.3), camera, grid, ground, floor);
		expect(balcony.center.y).toBe(raised);
		expect(balcony.from.y).toBeGreaterThan(raised + 1);
	});
});
