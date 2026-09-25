import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { DiceLayer } from './dice3d';
import { DIE_LABELS } from './dice-faces';
import type { DieKind } from './dice-throw';

/** A DiceLayer whose number textures carry their text instead of drawing it (no DOM in Node). */
function layer() {
	const l = new DiceLayer();
	(l as unknown as { label: (text: string, kind: string, ink: string) => THREE.Texture }).label = (
		text
	) => {
		const t = new THREE.Texture();
		t.userData.text = text;
		return t;
	};
	return l;
}

/** The number a player reads on a landed die: its highest label. */
function reading(l: DiceLayer): string {
	const root = l.group.children[0];
	root.updateMatrixWorld(true);
	let best = { y: -Infinity, text: '' };
	for (const child of root.children.slice(1) as THREE.Mesh<
		THREE.BufferGeometry,
		THREE.MeshStandardMaterial
	>[]) {
		const y = new THREE.Vector3().setFromMatrixPosition(child.matrixWorld).y;
		if (y > best.y + 1e-6) best = { y, text: child.material.map!.userData.text };
	}
	return best.text;
}

describe('DiceLayer', () => {
	const kinds: DieKind[] = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100tens', 'd100units'];

	it.each(kinds)('%s lands reading the rolled face, for every face', (kind) => {
		const l = layer();
		DIE_LABELS[kind].forEach((label, face) => {
			const ms = l.throw(
				{ seq: face + 3, dice: [{ kind, face }], color: '#ffffff' },
				new THREE.Vector3(),
				new THREE.Vector3(0, 2, 4),
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
			new THREE.Vector3(),
			new THREE.Vector3(0, 2, 4),
			1,
			false,
			5000
		);
		l.tick(5000 + ms / 2); // one slow frame mid-flight
		l.tick(5000 + ms + 1); // the next frame, after landing time
		expect(reading(l)).toBe('20');
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
			new THREE.Vector3(),
			new THREE.Vector3(),
			1,
			false,
			0
		);
		expect(l.group.children).toHaveLength(2);
		l.throw(
			{ seq: 2, dice: [{ kind: 'd8', face: 0 }], color: '#fff' },
			new THREE.Vector3(),
			new THREE.Vector3(),
			1,
			false,
			0
		);
		expect(l.group.children).toHaveLength(1);
		expect(l.tick(60_000)).toBe(false);
		expect(l.group.children).toHaveLength(0);
	});
});
