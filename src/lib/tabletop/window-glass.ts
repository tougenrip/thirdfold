// Glazed windows' panes (#260): a pool (piece-pool.ts, M70) of three meshes, the dark panes' outer
// halves and every pane's inner half in one material and the outer halves of panes that light
// after dusk in another, both in the kit pieces' graph (the surface kind's `piece` variant with
// colours, warmed by the walls' stand-in), so they compile nothing. The lit panes' material holds white in its emissive slot and the warm glow as
// values: `setGlow` writes its intensity when the sky's night glow changes, never per frame.
// Emissive only: no light list, bounce or probe reads it (the probe bake hides `group`,
// renderer.ts), and `worldEmissive` dims it by the fog of the cell in front of it, so none glows
// out of black. Which panes and which light: world/glazing.ts.

import * as THREE from 'three/webgpu';
import { tagged } from './perf';
import { PiecePool, putPiece, showPieces } from './piece-pool';
import {
	blankTexture,
	createMaterial,
	disposeTwins,
	setParams,
	SLOTS,
	twinOf,
	type KindMaterial
} from './materials';
import { kelvinToLinear } from './sky-maths';
import type { TileInput } from './world/autotile';
import type { Glazing } from './world/glazing';
import type { WorldBuilders } from './world-layer';

/** A lit pane's emissive at full night: over 1, so bloom catches it (#160). */
export const GLOW_STRENGTH = 2.5;
/** Lamplight behind glass. */
const GLOW_KELVIN = 2200;
/** The pool's meshes: dark outer halves, inner halves (never lit: exterior only), lit outer halves. */
const [OUTER, INNER, LIT] = [0, 1, 2];
/** The emissive slot's texel for the lit panes: the whole pane glows. */
const WHITE = blankTexture({ ...SLOTS.emissive, texel: [255, 255, 255, 255] });

export class WindowGlass {
	readonly group = tagged(new THREE.Group(), 'window glass');
	/** Panes that stay dark (0) and panes that light (1). */
	private materials: KindMaterial[];
	private readonly pool = new PiecePool(this.group);
	private lit = 0;
	private panes: Glazing | null = null;
	private dark: Uint8Array | null = null;
	private glow = 0;

	constructor(private readonly build: WorldBuilders) {
		const options = { piece: true, antiTiled: true, vertexColors: true } as const;
		const params = { color: 0xffffff, roughness: 0.3 };
		const warm = new THREE.Color().setRGB(...kelvinToLinear(GLOW_KELVIN));
		this.materials = [
			createMaterial('surface', { ...options, params }),
			createMaterial('surface', {
				...options,
				params: { ...params, emissive: warm, emissiveIntensity: 0 },
				slots: { emissive: WHITE }
			})
		];
		const [dark, lit] = this.materials;
		this.pool.make(
			new Map([
				[OUTER, { mesh: build.paneMesh(true), material: dark }],
				[INNER, { mesh: build.paneMesh(false), material: dark }],
				[LIT, { mesh: build.paneMesh(true), material: lit }]
			])
		);
	}

	/** The glazed windows of a tile input; the edges the walls draw as frames. */
	sync(input: TileInput): Set<number> {
		this.panes = this.build.glazing(input);
		this.draw();
		return this.panes.edges;
	}

	/** The dark areas as sent (#203): a pane whose inside is dark stays dark. */
	setDarkness(mask: Uint8Array | null): void {
		if (mask === this.dark) return;
		this.dark = mask;
		this.draw();
	}

	/** The sky's night glow (atmosphere-curve.ts): the lit panes' brightness, 0 by day. */
	setGlow(nightGlow: number): void {
		const glow = this.build.windowGlow(nightGlow);
		if (glow === this.glow) return;
		this.glow = glow;
		setParams(this.materials[1], { emissiveIntensity: GLOW_STRENGTH * glow });
	}

	/** The panes as drawn, for tests: how many, how many light, and the glow now. */
	stats(): { panes: number; lit: number; glow: number } {
		return { panes: this.panes?.count ?? 0, lit: this.lit, glow: this.glow };
	}

	/** The tier's anti-tiling (#181), as the walls' materials follow it. */
	setAntiTiled(on: boolean): void {
		if (!!this.materials[0].options.antiTiled === on) return;
		this.materials = this.materials.map((m) => twinOf(m));
		this.pool.setMaterial((key) => this.materials[key === LIT ? 1 : 0]);
	}

	dispose(): void {
		this.pool.dispose();
		this.materials.forEach(disposeTwins);
	}

	private draw(): void {
		const g = this.panes;
		if (!g) return;
		const lit = this.build.litPanes(g, this.dark);
		const all = [...lit.keys()];
		// Each pane's outer half in the mesh of its lighting, every inner half in its own.
		const halves = [all.filter((i) => !lit[i]), all, all.filter((i) => lit[i])];
		halves.forEach((list, key) => {
			const mesh = this.pool.reserve(key, list.length);
			if (!mesh) return;
			list.forEach((i, n) => putPiece(mesh, n, g.matrices, i * 16, g.seed[i], false));
			showPieces(mesh, list.length);
		});
		this.lit = halves[LIT].length;
	}
}
