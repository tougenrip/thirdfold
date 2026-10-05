// The grid and the hover highlight (#245), in the overlay's scene. Each world chunk's tops have a
// twin here: the same geometry in a second mesh (no memory of its own) on the overlay kind's
// `grid` variant (materials/grid.ts), which draws the antialiased lines on the ground wherever it
// stands and the highlighted cell's pattern. The overlay's pass draws with the unjittered camera
// against the world's jittered depth, so the twins test less-or-equal with a polygon offset toward
// the camera and never fight their tops. Modes, the focus and the highlight are uniform writes:
// nothing compiles, and the twins are hidden while there is neither grid nor highlight to draw.

import * as THREE from 'three/webgpu';
import type { GridPos } from '$lib/game/grid';
import { GRID_STRENGTH, HIGHLIGHT_PATTERN, type GridMode } from './grid-modes';
import { createMaterial } from './materials';
import { gridUniforms as u } from './materials/grid';
import { HIGHLIGHT } from './previews';
import type { HighlightKind } from './types';
import { standIn } from './warmup';

const NONE = -1e4;

export class GridOverlay {
	/** In the overlay's scene: the twins. */
	readonly group = new THREE.Group();
	private readonly twins = new THREE.Group();
	private readonly material = createMaterial('overlay', { grid: true });
	private stands: THREE.Object3D[] | null = null;

	constructor() {
		// Less-or-equal (the default) and nudged toward the camera: on its top, never under it.
		this.material.polygonOffset = true;
		this.material.polygonOffsetFactor = -2;
		this.material.polygonOffsetUnits = -4;
		this.twins.renderOrder = 1;
		this.group.add(this.twins);
		this.show();
	}

	/** A twin for a chunk's tops, drawn in the overlay's scene (`follow` keeps it on them). */
	twin(): THREE.Mesh {
		const mesh = new THREE.Mesh(undefined, this.material);
		mesh.raycast = () => {};
		this.twins.add(mesh);
		return mesh;
	}

	/** Puts `twin` on `top`'s geometry, shown as it is (after the chunk was built). */
	follow(twin: THREE.Mesh, top: THREE.Mesh): void {
		twin.geometry = top.geometry;
		twin.visible = top.visible;
	}

	/**
	 * How much grid shows (`GridMode`), round `focus` in explore mode (the hovered cell, the selected
	 * token's): uniform writes. True when anything changed (one frame to draw).
	 */
	setMode(mode: GridMode, focus: readonly (GridPos | null)[] = []): boolean {
		const was = [u.strength.value, u.local.value, ...u.focusA.value, ...u.focusB.value];
		u.strength.value = GRID_STRENGTH[mode];
		u.local.value = mode === 'explore' ? 1 : 0;
		const [a, b] = focus.filter((c): c is GridPos => !!c);
		u.focusA.value.set(a ? a.x + 0.5 : NONE, a ? a.y + 0.5 : NONE);
		u.focusB.value.set(b ? b.x + 0.5 : NONE, b ? b.y + 0.5 : NONE);
		const now = [u.strength.value, u.local.value, ...u.focusA.value, ...u.focusB.value];
		this.show();
		return now.some((v, i) => v !== was[i]);
	}

	/** The hovered cell's highlight in its kind's colour and pattern, or none. */
	setHighlight(cell: GridPos | null, kind: HighlightKind): void {
		u.hover.value.set(cell ? cell.x : NONE, cell ? cell.y : NONE);
		u.pattern.value = cell ? HIGHLIGHT_PATTERN[kind] : 0;
		u.highlight.value.setHex(HIGHLIGHT[kind]);
		this.show();
	}

	/**
	 * Stand-ins for the warm-up (warmup.ts): the twins are hidden until a mode or a hover shows
	 * them, and their first draw would make a pipeline mid-game.
	 */
	gallery(): THREE.Object3D[] {
		if (!this.stands) {
			const g = new THREE.BufferGeometry();
			g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 1, 1, 0, 0], 3));
			g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
			const twin = new THREE.Mesh(g, this.material);
			this.stands = [standIn(twin)];
		}
		return this.stands;
	}

	dispose(): void {
		this.twins.clear(); // their geometry is the chunks'
		this.material.dispose();
		(this.stands?.[0] as THREE.Mesh | undefined)?.geometry.dispose();
	}

	private show(): void {
		this.twins.visible = u.strength.value > 0 || u.pattern.value > 0;
	}
}
