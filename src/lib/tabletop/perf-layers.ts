// What one frame draws, by layer and pass (#264): every draw three counts (`info.update`, one per
// BatchedMesh instance on WebGPU, one per multi-draw on WebGL2) put down to the layer it belongs
// to (the nearest `userData.perfLayer` up its parents, else its material's kind (`terrain` the
// ground's tops, `rock` its faces with the stairs and bridges, `surface` the void and beyond,
// `mini` tokens, `prop` props and fixtures), else `post` for an effect's quad) and the pass drawing it (the sun's or the moon's shadow, a hero light's cube,
// the prepass, the scene pass, the overlay). For each batch, `instanced` is what the same frame
// would draw with an InstancedMesh per piece geometry instead: the distinct pieces it drew in each
// pass. Read by `scripts/perf-gpu.mjs` (`LAYERS=1`) under `?perf`, loaded only then (its own
// chunk); layers are named with perf.ts `tagged`.

import type * as THREE from 'three/webgpu';

/** Draws and triangles. */
export interface Cost {
	draws: number;
	triangles: number;
}

/** What a layer holds on the table, drawn or not. */
export interface LayerHolds {
	meshes: number;
	instances: number;
	/** Triangles of every instance. */
	triangles: number;
	/** Bytes of its geometries' attributes and indices. */
	bytes: number;
}

export interface LayerReport {
	/** The frame: draws and triangles in all (three's own counters). */
	total: Cost;
	/** By pass, then layer. */
	passes: Record<string, Record<string, Cost>>;
	/** Each layer's batches drawn as an InstancedMesh per piece instead: draws, all passes. */
	instanced: Record<string, number>;
	holds: Record<string, LayerHolds>;
}

interface Drawn {
	parent: THREE.Object3D | null;
	userData: Record<string, unknown>;
	material?: THREE.Material | THREE.Material[];
}

/** The layer a drawn object belongs to. */
export function layerOf(object: Drawn): string {
	for (let o: Drawn | null = object; o; o = o.parent)
		if (typeof o.userData.perfLayer === 'string') return o.userData.perfLayer;
	if (!object.parent) return 'post';
	const m = Array.isArray(object.material) ? object.material[0] : object.material;
	return m?.name || `other (${(object as { type?: string }).type})`;
}

interface Context {
	camera: THREE.Camera | null;
	mrt?: { outputNodes: Record<string, unknown> } | null;
}

/** The pass a render context draws: a shadow map, a hero light's cube, or a pipeline pass. */
export function passOf(context: Context | null, main: THREE.Camera | null): string {
	const camera = context?.camera;
	if (camera !== main && (camera as THREE.OrthographicCamera | undefined)?.isOrthographicCamera)
		return 'shadow';
	// A hero light's cube faces: square, 90° (hero-light-node.ts).
	const lens = camera as THREE.PerspectiveCamera | undefined;
	if (lens && lens !== main && lens.fov === 90 && lens.aspect === 1) return 'hero';
	// The pipeline's passes share one target name; their outputs tell them apart (passes.ts).
	const outputs = Object.keys(context?.mrt?.outputNodes ?? {});
	if (outputs.includes('emissive')) return 'scene';
	if (outputs.length) return 'prepass';
	// The overlay's pass draws with an unjittered copy of the view's camera (overlay.ts).
	return camera && camera !== main ? 'overlay' : 'output';
}

interface Batched {
	isBatchedMesh?: boolean;
	_multiDrawStarts: Int32Array;
	_multiDrawCount: number;
}

type Info = THREE.WebGPURenderer['info'] & {
	update(object: THREE.Object3D, count: number, instances: number): void;
};

/** A steady frame, and the same frame with the key light's shadow map drawn again in it. */
export interface LayerReports {
	steady: LayerReport;
	/** What any change to the table costs (a token moving): the sun's or moon's map redrawn. */
	shadowed: LayerReport;
}

/**
 * Draws the view twice (`draw`, the tabletop's own frame), counting each draw by layer and pass:
 * once as it is, once with every casting directional light's map due again (as a change to the
 * table makes it, renderer.ts `shadowsDirty`).
 */
export function layerReports(renderer: THREE.WebGPURenderer, draw: () => void): LayerReports {
	const steady = layerReport(renderer, draw);
	for (const root of steady.roots)
		root.traverse((o) => {
			const light = o as THREE.DirectionalLight;
			if (light.isDirectionalLight && light.castShadow) light.shadow.needsUpdate = true;
		});
	return { steady: steady.report, shadowed: layerReport(renderer, draw).report };
}

/** Draws one frame counting each draw by layer and pass; also the scenes it drew. */
function layerReport(renderer: THREE.WebGPURenderer, draw: () => void) {
	const info = renderer.info as Info;
	const own = info.update;
	const contextOf = () =>
		(renderer as unknown as { _currentRenderContext: Context | null })._currentRenderContext;
	type Drew = { object: THREE.Object3D; context: Context | null; triangles: number };
	const records: Drew[] = [];
	const instanced = new Map<string, number>();
	/** Each batch's passes counted so far, by render context. */
	const seen = new Map<object, Set<unknown>>();
	const roots = new Set<THREE.Object3D>();
	info.update = function (object, count, instances) {
		const before = this.render.triangles;
		own.call(this, object, count, instances);
		const context = contextOf();
		records.push({ object, context, triangles: this.render.triangles - before });
		let root = object;
		while (root.parent) root = root.parent;
		if (root !== object) roots.add(root);
		const b = object as unknown as Batched;
		if (!b.isBatchedMesh) return;
		const passes = seen.get(object) ?? seen.set(object, new Set()).get(object)!;
		if (passes.has(context)) return;
		passes.add(context);
		const pieces = new Set(b._multiDrawStarts.subarray(0, b._multiDrawCount)).size;
		const layer = layerOf(object);
		instanced.set(layer, (instanced.get(layer) ?? 0) + pieces);
	};
	try {
		draw();
	} finally {
		info.update = own;
	}
	// The view's camera: the scene pass's, the one with an emissive output (passes.ts).
	const main = records.find((r) => r.context?.mrt?.outputNodes.emissive)?.context?.camera ?? null;
	const passes: LayerReport['passes'] = {};
	for (const r of records) {
		const layer = layerOf(r.object);
		// An effect's quad (no parent) is drawn by its own orthographic camera: not a shadow.
		const pass = (passes[layer === 'post' ? 'post' : passOf(r.context, main)] ??= {});
		const cost = (pass[layer] ??= { draws: 0, triangles: 0 });
		cost.draws++;
		cost.triangles += r.triangles;
	}
	const report: LayerReport = {
		total: { draws: info.render.drawCalls, triangles: info.render.triangles },
		passes,
		instanced: Object.fromEntries(instanced),
		holds: holdings(roots)
	};
	return { report, roots };
}

/** What each layer under `roots` holds: visible meshes, their instances, triangles and bytes. */
function holdings(roots: Iterable<THREE.Object3D>): Record<string, LayerHolds> {
	const out: Record<string, LayerHolds> = {};
	const counted = new Set<object>();
	const bytesOf = (g: THREE.BufferGeometry) => {
		if (counted.has(g)) return 0;
		counted.add(g);
		let n = g.index?.array.byteLength ?? 0;
		for (const a of Object.values(g.attributes))
			n += (a.array as ArrayLike<number> & { byteLength: number }).byteLength;
		return n;
	};
	for (const root of roots)
		root.traverseVisible((o) => {
			const mesh = o as THREE.Mesh;
			if (!mesh.isMesh) return;
			const h = (out[layerOf(mesh)] ??= { meshes: 0, instances: 0, triangles: 0, bytes: 0 });
			h.meshes++;
			h.bytes += bytesOf(mesh.geometry);
			const batch = o as THREE.BatchedMesh;
			const inst = o as THREE.InstancedMesh;
			const per = (mesh.geometry.index?.count ?? mesh.geometry.attributes.position?.count ?? 0) / 3;
			if (batch.isBatchedMesh) {
				const all = (
					batch as unknown as {
						_instanceInfo: { active: boolean; visible: boolean; geometryIndex: number }[];
					}
				)._instanceInfo;
				for (const i of all) {
					if (!i.active || !i.visible) continue;
					h.instances++;
					h.triangles += (batch.getGeometryRangeAt(i.geometryIndex)?.count ?? 0) / 3;
				}
			} else if (inst.isInstancedMesh) {
				h.instances += inst.count;
				h.triangles += per * inst.count;
			} else {
				h.instances++;
				h.triangles += per;
			}
		});
	return out;
}
