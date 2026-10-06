// Glazed windows' panes (#260): one BatchedMesh of panes that stay dark (and every pane's inner
// half) and one of the outer halves of panes that light after dusk, both in the kit pieces' graph
// (the surface kind's `batched` variant with colours, warmed by the walls' stand-in), so they
// compile nothing. The lit panes' material holds white in its emissive slot and the warm glow as
// values: `setGlow` writes its intensity when the sky's night glow changes, never per frame.
// Emissive only: no light list, bounce or probe reads it (the probe bake hides `group`,
// renderer.ts), and `worldEmissive` dims it by the fog of the cell in front of it, so none glows
// out of black. Which panes and which light: world/glazing.ts.

import * as THREE from 'three/webgpu';
import { addPiece, colourOf, newBatch, type Batch } from './batch';
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
/** The pane's halves' geometry ids: the outer one glows, the inner never does (exterior only). */
const [OUTER, INNER] = [0, 1];
/** The emissive slot's texel for the lit panes: the whole pane glows. */
const WHITE = blankTexture({ ...SLOTS.emissive, texel: [255, 255, 255, 255] });

export class WindowGlass {
	readonly group = new THREE.Group();
	/** Panes that stay dark (0) and panes that light (1). */
	private materials: KindMaterial[];
	private readonly batches: Batch[];
	private panes: Glazing | null = null;
	private dark: Uint8Array | null = null;
	private glow = 0;

	constructor(private readonly build: WorldBuilders) {
		const options = { batched: true, antiTiled: true, vertexColors: true } as const;
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
		this.batches = this.materials.map((m, lit) => {
			const b = newBatch(m);
			addPiece(b, OUTER, build.paneMesh(true));
			if (!lit) addPiece(b, INNER, build.paneMesh(false));
			b.mesh.visible = false;
			this.group.add(b.mesh);
			return b;
		});
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
		return { panes: this.panes?.count ?? 0, lit: this.batches[1].ids.length, glow: this.glow };
	}

	/** The tier's anti-tiling (#181), as the walls' materials follow it. */
	setAntiTiled(on: boolean): void {
		if (!!this.materials[0].options.antiTiled === on) return;
		this.materials = this.materials.map((m) => twinOf(m));
		this.batches.forEach((b, i) => (b.mesh.material = this.materials[i]));
	}

	dispose(): void {
		for (const b of this.batches) b.mesh.dispose();
		this.materials.forEach(disposeTwins);
	}

	private draw(): void {
		const g = this.panes;
		if (!g) return;
		const lit = this.build.litPanes(g, this.dark);
		const m = new THREE.Matrix4();
		// Each pane's outer half in the batch of its lighting, every inner half in the dark one.
		const all = [...lit.keys()];
		const halves = [
			[...all.filter((i) => !lit[i]).map((i) => [i, OUTER]), ...all.map((i) => [i, INNER])],
			all.filter((i) => lit[i]).map((i) => [i, OUTER])
		];
		this.batches.forEach((b, on) => {
			const list = halves[on];
			const { mesh } = b;
			while (b.ids.length > list.length) mesh.deleteInstance(b.ids.pop()!);
			if (list.length > mesh.maxInstanceCount) mesh.setInstanceCount(Math.ceil(list.length * 1.5));
			while (b.ids.length < list.length) b.ids.push(mesh.addInstance(OUTER));
			list.forEach(([i, half], n) => {
				mesh.setGeometryIdAt(b.ids[n], half);
				mesh.setMatrixAt(b.ids[n], m.fromArray(g.matrices, i * 16));
				mesh.setColorAt(b.ids[n], colourOf(g.seed[i], false));
			});
			mesh.visible = list.length > 0;
			mesh.computeBoundingBox();
			mesh.computeBoundingSphere();
		});
	}
}
