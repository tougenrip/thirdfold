// The asset turntable (#194): one manifest model on a small table, drawn by the real renderer
// with the game's shader kinds and light, for art reviews and thumbnails. Dev only: the page
// (src/routes/dev/assets) imports this module inside `import.meta.env.DEV`, so production builds
// drop it, which scripts/check-bundle.mjs asserts (by the marker below).

import * as THREE from 'three/webgpu';
import { fetchAsset, loadManifest } from '$lib/assets/load';
import { isFigureKind, type Manifest, type ModelEntry } from '$lib/assets/manifest';
import { FLOOR_IDS, type FloorId } from '$lib/game/floor';
import { MAX_LIGHT_RADIUS, type Ambient, type Light } from '$lib/game/lights';
import { WALL_HEIGHT, STEP_HEIGHT } from './ground';
import { createMaterial, repeatFor, withBake, type KindMaterial } from './materials';
import { SURFACE_CELLS } from './materials/floors';
import { loadModel, parseModel, type LoadedModel, type ModelPart } from './models';
import { createTabletop } from './renderer';
import { loadSurface } from './surfaces';
import { initialShape, shapeOf, startingSettings } from './shape';
import type { QualitySettings } from './quality';
import type { Pose } from './shots';
import type { Tabletop } from './types';

/**
 * Day and dusk as the game has them; torchlight and moonlight are its night lit by a torch a cell
 * off the model's corner, or by a Moonlight light (LIGHT_COLORS) from the table's corner.
 */
export const LIGHTS = {
	day: { ambient: 'day', light: null },
	dusk: { ambient: 'dusk', light: null },
	torch: { ambient: 'dark', light: 'torch' },
	moon: { ambient: 'dark', light: 'moon' }
} as const satisfies Record<string, { ambient: Ambient; light: 'torch' | 'moon' | null }>;

function lightOf(kind: 'torch' | 'moon', side: number): Light {
	const mid = (side - 1) / 2;
	return kind === 'torch'
		? { id: kind, pos: { x: mid + 1, y: mid - 1 }, radius: 4, color: '#ffa04d', on: true }
		: {
				id: kind,
				pos: { x: side - 1, y: side - 1 },
				radius: MAX_LIGHT_RADIUS,
				color: '#b8c8ff',
				on: true
			};
}
/** The table's cells a side for a model `bounds`: odd, so its centre cell is the origin. */
export function sideFor(bounds: ModelEntry['bounds']): number {
	const half = Math.max(...[0, 2].flatMap((i) => [-bounds.min[i], bounds.max[i]]));
	return Math.max(5, 2 * Math.ceil(half) + 3);
}
export type LightPreset = keyof typeof LIGHTS;

/** The manifest's models whose id or kind matches `query`, by kind then id. */
export function modelList(manifest: Manifest, query = ''): [string, ModelEntry][] {
	const q = query.trim().toLowerCase();
	return Object.entries(manifest.models)
		.filter(([id, e]) => !q || id.includes(q) || e.kind.includes(q))
		.sort(([a, x], [b, y]) => x.kind.localeCompare(y.kind) || a.localeCompare(b));
}

/** Triangles at each level the model carries. */
export function trianglesByLod(model: LoadedModel): number[] {
	const out: number[] = [];
	for (const p of model.parts) out[p.lod] = (out[p.lod] ?? 0) + (p.geometry.index?.count ?? 0) / 3;
	return [...out].map((n) => n ?? 0);
}

export interface TextureFact {
	slot: string;
	width: number;
	height: number;
	compressed: boolean;
}

/** The textures its parts carry, once each. */
export function texturesOf(model: LoadedModel): TextureFact[] {
	const seen = new Map<THREE.Texture, string>();
	for (const p of model.parts)
		for (const [slot, t] of Object.entries(p.maps ?? {})) if (!seen.has(t)) seen.set(t, slot);
	return [...seen].map(([t, slot]) => ({
		slot,
		width: (t.image as { width?: number })?.width ?? 0,
		height: (t.image as { height?: number })?.height ?? 0,
		compressed: !!(t as THREE.CompressedTexture).isCompressedTexture
	}));
}

/**
 * The model at `lod` as the game draws it: a figure stands on its base in the mini kind (its
 * accent in `accent`), anything else in the prop kind. The materials are the caller's to free.
 */
export function modelGroup(
	model: LoadedModel,
	lod: number,
	accent = '#b0413e'
): { group: THREE.Group; materials: KindMaterial[] } {
	const group = new THREE.Group();
	const materials: KindMaterial[] = [];
	const figure = isFigureKind(model.entry.kind);
	const kind = figure ? 'mini' : 'prop';
	const add = (geometry: THREE.BufferGeometry, material: KindMaterial, y: number) => {
		materials.push(material);
		const mesh = new THREE.Mesh(geometry, material);
		mesh.position.y = y;
		mesh.castShadow = mesh.receiveShadow = true;
		group.add(mesh);
		return mesh;
	};
	const lift = figure ? 0.08 : 0;
	if (figure) {
		const base = withBake(new THREE.CylinderGeometry(0.42, 0.44, 0.08, 32));
		add(base, createMaterial('mini', { params: { color: 0x1b1612, roughness: 0.6 } }), 0.04);
		group.userData.base = base;
	}
	for (const part of model.parts.filter((p: ModelPart) => p.lod === lod)) {
		const accented = part.role === 'accent';
		const params = part.maps ? part.params : accented ? { color: accent } : { roughness: 0.6 };
		const material = createMaterial(kind, {
			vertexColors: !accented,
			params,
			slots: part.maps ?? undefined
		});
		add(part.geometry, material, lift);
	}
	return { group, materials };
}

export interface Shown {
	model: LoadedModel;
	/** Triangles per level. */
	triangles: number[];
	textures: TextureFact[];
	/** What the renderer's texture memory grew by when it first loaded (0 once cached). */
	texturesBytes: number;
}

export interface Turntable {
	readonly tabletop: Tabletop;
	/** Shows a model at a level, full or its preview (#192); null if it can't load. */
	show(id: string, lod: number, preview: boolean): Promise<Shown | null>;
	/** Shows a surface of the library (#187) on a 3×3-cell floor and a wall; false if it can't load. */
	showSurface(id: string): Promise<boolean>;
	setLight(preset: LightPreset): void;
	setEnvironment(id: string | null): void;
	/** Turns the model (radians); drags orbit the camera. */
	turn(by: number): void;
	/** A slow spin, never under reduced motion. */
	setSpin(on: boolean): void;
	/** The three-quarter pose thumbnails are taken from. */
	frame(): void;
	dispose(): Promise<void>;
}

const noop = () => {};

export async function createTurntable(
	canvas: HTMLCanvasElement,
	options: {
		reducedMotion?: boolean;
		/** Thumbnails: a small model is drawn larger, to fill the frame (the camera stops 3 cells off). */
		fill?: boolean;
	} = {}
): Promise<Turntable> {
	let scene: THREE.Scene | null = null;
	let redraw = noop;
	// MSAA is fixed with the renderer, and a second renderer on this canvas would find its context
	// gone: a tier that wants the other keeps this one's (ponytail: the table's own rebuild on a
	// fresh canvas, Tabletop.svelte, if a review ever needs it exact).
	canvas.dataset.tool = 'thirdfold-turntable'; // what check-bundle.mjs looks for in production
	const antialias = initialShape().antialias;
	const tabletop = await createTabletop(
		canvas,
		{ onClick: noop, onHover: noop },
		{
			antialias,
			reducedMotion: options.reducedMotion,
			devScene: (s, r) => ((scene = s), (redraw = r))
		}
	);
	const starting = startingSettings(tabletop.capabilities());
	const settings: QualitySettings =
		shapeOf(starting).antialias === antialias
			? starting
			: { ...starting, ...(antialias ? { aa: 'msaa', msaa: 4 } : { aa: 'fxaa', msaa: 0 }) };
	tabletop.setQuality(settings);
	tabletop.setFog(null, 'gm');
	let side = 0;
	let light: LightPreset = 'day';
	/** The floor a surface paints the whole table with (#187), drawn by the terrain kind. */
	let floor = 0;
	const table = (next: number) => {
		side = next;
		tabletop.setGrid({ kind: 'square', cellSize: 1, width: side, height: side });
		tabletop.setFloor(floor ? new Uint8Array(side * side).fill(floor) : null);
		turntable.setLight(light);
	};

	const holder = new THREE.Group();
	scene!.add(holder);
	let current: {
		group: THREE.Group;
		materials: KindMaterial[];
		preview: LoadedModel | null;
	} | null = null;
	let bounds: ModelEntry['bounds'] | null = null;
	const measured = new Map<string, number>();
	const reduced = options.reducedMotion ?? matchMedia('(prefers-reduced-motion: reduce)').matches;
	let spin = 0;

	function clear(): void {
		if (!current) return;
		holder.remove(current.group);
		for (const m of current.materials) m.dispose();
		(current.group.userData.base as THREE.BufferGeometry | undefined)?.dispose();
		for (const g of (current.group.userData.geometries as THREE.BufferGeometry[]) ?? [])
			g.dispose();
		for (const p of current.preview?.parts ?? []) {
			p.geometry.dispose();
			for (const t of Object.values(p.maps ?? {})) t.dispose();
		}
		current = null;
	}

	async function load(entry: ModelEntry, id: string, preview: boolean) {
		if (!preview) return loadModel(id);
		const p = entry.preview;
		if (!p) return null;
		return parseModel({ ...entry, ...p, lods: undefined }, await fetchAsset(p.file, p.sha256));
	}

	const turntable: Turntable = {
		tabletop,
		async show(id, lod, preview) {
			const entry = (await loadManifest()).models[id];
			if (!entry) return null;
			const before = tabletop.stats().texturesBytes;
			const model = await load(entry, id, preview);
			if (!model) return null;
			if (floor) {
				floor = 0;
				table(side);
			}
			const key = `${id}:${preview}`;
			if (!measured.has(key)) measured.set(key, tabletop.stats().texturesBytes - before);
			clear();
			const levels = trianglesByLod(model);
			const made = modelGroup(model, Math.min(lod, levels.length - 1));
			current = { ...made, preview: preview ? model : null };
			holder.add(made.group);
			bounds = entry.bounds;
			if (sideFor(bounds) !== side) table(sideFor(bounds));
			turntable.frame();
			redraw();
			return {
				model,
				triangles: levels,
				textures: texturesOf(model),
				texturesBytes: measured.get(key) ?? 0
			};
		},
		async showSurface(id) {
			const maps = await loadSurface(id);
			if (!maps) return false;
			clear();
			// A floor's surface also covers the table, so an environment shows it as the game does.
			floor = Math.max(0, FLOOR_IDS.indexOf(id as FloorId));
			const slots = { albedo: maps.map, normal: maps.normal, orm: maps.orm };
			const params = { repeat: repeatFor(SURFACE_CELLS, 1, STEP_HEIGHT), roughness: 1 };
			const group = new THREE.Group();
			const materials = [0, 1].map(() =>
				createMaterial('surface', { antiTiled: true, params, slots })
			);
			const plane = new THREE.Mesh(new THREE.BoxGeometry(3, 0.02, 3), materials[0]);
			plane.position.y = 0.01;
			const wall = new THREE.Mesh(new THREE.BoxGeometry(3, WALL_HEIGHT, 0.14), materials[1]);
			wall.position.set(0, WALL_HEIGHT / 2, -1.57);
			for (const mesh of [plane, wall]) {
				mesh.castShadow = mesh.receiveShadow = true;
				group.add(mesh);
			}
			group.userData.geometries = [plane.geometry, wall.geometry];
			current = { group, materials, preview: null };
			holder.add(group);
			bounds = { min: [-1.5, 0, -1.6], max: [1.5, WALL_HEIGHT, 1.5] };
			table(sideFor(bounds));
			turntable.frame();
			redraw();
			return true;
		},
		setLight(preset) {
			light = preset;
			const { ambient, light: kind } = LIGHTS[preset];
			tabletop.setLighting(ambient, kind ? [lightOf(kind, side)] : []);
		},
		setEnvironment: (id) => tabletop.setEnvironment(id),
		turn(by) {
			holder.rotation.y += by;
			redraw();
		},
		setSpin(on) {
			cancelAnimationFrame(spin);
			spin = 0;
			if (!on || reduced) return;
			let last = performance.now();
			const tick = (now: number) => {
				// A slow turn, redrawn at about 30 frames a second at most.
				if (now - last >= 33) {
					turntable.turn(((now - last) / 1000) * 0.4);
					last = now;
				}
				spin = requestAnimationFrame(tick);
			};
			spin = requestAnimationFrame(tick);
		},
		frame() {
			if (!bounds) return;
			const [min, max] = [bounds.min, bounds.max];
			const extent = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
			const scale = options.fill ? Math.max(1, 1.4 / extent) : 1;
			holder.scale.setScalar(scale);
			const size = Math.max(extent * scale, 1);
			const target = { x: 0, y: (scale * (max[1] + min[1])) / 2, z: 0 };
			const d = Math.max(3.2, size * 2.2);
			const pose: Pose = {
				target,
				position: { x: d * 0.55, y: target.y + d * 0.5, z: d * 0.67 }
			};
			tabletop.setPose(pose);
		},
		async dispose() {
			turntable.setSpin(false);
			clear();
			await tabletop.dispose();
		}
	};
	table(5);
	return turntable;
}
