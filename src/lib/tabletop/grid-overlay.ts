// The grid and the hover highlight (#245), in the overlay's scene. Each world chunk's tops have a
// twin here: the same geometry in a second mesh (no memory of its own) on the overlay kind's
// `grid` variant (materials/grid.ts), which draws the antialiased lines on the ground wherever it
// stands and the highlighted cell's pattern. The overlay's pass draws with the unjittered camera
// against the world's jittered depth, so the twins test less-or-equal with a polygon offset toward
// the camera and never fight their tops. Modes, the focus and the highlight are uniform writes:
// nothing compiles, and the twins are hidden while there is neither grid nor highlight to draw.
//
// Until the milestone closes, the `terrain` layer off (`?off=terrain`) draws the old
// `LineSegments` grid and highlight plane instead, with the old boxes and play plane; the close
// deletes them (and `setGrid` with them).

import * as THREE from 'three/webgpu';
import { float } from 'three/tsl';
import { gridToWorld, type GridPos, type SquareGrid } from '$lib/game/grid';
import { groundFlat } from './cell-maps';
import { GRID_COLOR, GRID_STRENGTH, HIGHLIGHT_PATTERN, type GridMode } from './grid-modes';
import type { Ground } from './ground';
import { createMaterial } from './materials';
import { gridUniforms as u } from './materials/grid';
import { floorPalette } from './materials/hooks';
import { worldShade } from './materials/world-modify';
import { HIGHLIGHT } from './previews';
import type { HighlightKind } from './types';
import { standIn } from './warmup';

/** The old lines' opacity at full strength (`?off=terrain` only). */
const LEGACY_OPACITY = 0.35;
const NONE = -1e4;

export class GridOverlay {
	/** In the overlay's scene: the twins, and the old lines and plane. */
	readonly group = new THREE.Group();
	private readonly twins = new THREE.Group();
	private readonly material = createMaterial('overlay', { grid: true });
	private lines: THREE.LineSegments | null = null;
	private readonly lineMaterial = new THREE.LineBasicNodeMaterial({
		color: GRID_COLOR,
		transparent: true,
		depthWrite: false
	});
	private readonly plane = new THREE.Mesh(
		new THREE.PlaneGeometry(0.94, 0.94),
		new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.35, depthWrite: false })
	);
	private on = true;
	private stands: THREE.Object3D[] | null = null;

	constructor() {
		// Less-or-equal (the default) and nudged toward the camera: on its top, never under it.
		this.material.polygonOffset = true;
		this.material.polygonOffsetFactor = -2;
		this.material.polygonOffsetUnits = -4;
		this.twins.renderOrder = 1;
		const entry = floorPalette.element(groundFlat.x.mul(255).add(0.5).toInt());
		const cover = (entry as unknown as THREE.Node<'vec4'>).w;
		this.lineMaterial.opacityNode = float(LEGACY_OPACITY)
			.mul(u.strength)
			.mul(float(1).sub(cover))
			.mul(worldShade() as unknown as THREE.Node<'float'>);
		this.plane.rotation.x = -Math.PI / 2;
		this.plane.renderOrder = 2;
		this.group.add(this.twins, this.plane);
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

	/** The shader grid on the chunks (on), or the old lines and plane (`?off=terrain`). */
	setOn(on: boolean): void {
		this.on = on;
		this.show();
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
	setHighlight(
		cell: GridPos | null,
		kind: HighlightKind,
		grid: SquareGrid | null,
		ground: Ground | null
	): void {
		const shown = !!(cell && grid);
		u.hover.value.set(shown ? cell!.x : NONE, shown ? cell!.y : NONE);
		u.pattern.value = shown ? HIGHLIGHT_PATTERN[kind] : 0;
		u.highlight.value.setHex(HIGHLIGHT[kind]);
		if (shown) {
			const w = gridToWorld(grid!, cell!);
			this.plane.position.set(w.x, (ground?.floorY(cell!) ?? 0) + 0.04, w.z);
			this.plane.scale.setScalar(grid!.cellSize);
			this.plane.material.color.setHex(HIGHLIGHT[kind]);
		}
		this.show();
	}

	/** The old lines for a table (`?off=terrain` only): one draw call however large. */
	setGrid(g: SquareGrid): void {
		this.removeLines();
		const w = g.width * g.cellSize;
		const d = g.height * g.cellSize;
		const points: number[] = [];
		for (let i = 0; i <= g.width; i++) {
			const x = -w / 2 + i * g.cellSize;
			points.push(x, 0.005, -d / 2, x, 0.005, d / 2);
		}
		for (let j = 0; j <= g.height; j++) {
			const z = -d / 2 + j * g.cellSize;
			points.push(-w / 2, 0.005, z, w / 2, 0.005, z);
		}
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
		this.lines = new THREE.LineSegments(geometry, this.lineMaterial);
		this.group.add(this.lines);
		this.show();
	}

	/**
	 * Stand-ins for the warm-up (warmup.ts): the twins are hidden until a mode or a hover shows
	 * them, and their first draw would make a pipeline mid-game; the old plane likewise.
	 */
	gallery(): THREE.Object3D[] {
		if (!this.stands) {
			const g = new THREE.BufferGeometry();
			g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 1, 1, 0, 0], 3));
			g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
			const twin = new THREE.Mesh(g, this.material);
			this.stands = [twin, new THREE.Mesh(this.plane.geometry, this.plane.material)].map(standIn);
		}
		return this.stands;
	}

	dispose(): void {
		this.removeLines();
		this.twins.clear(); // their geometry is the chunks'
		this.material.dispose();
		this.lineMaterial.dispose();
		this.plane.geometry.dispose();
		this.plane.material.dispose();
		(this.stands?.[0] as THREE.Mesh | undefined)?.geometry.dispose();
	}

	private show(): void {
		const lines = u.strength.value > 0;
		this.twins.visible = this.on && (lines || u.pattern.value > 0);
		if (this.lines) this.lines.visible = !this.on && lines;
		this.plane.visible = !this.on && u.pattern.value > 0;
	}

	private removeLines(): void {
		if (!this.lines) return;
		this.lines.removeFromParent();
		this.lines.geometry.dispose();
		this.lines = null;
	}
}
