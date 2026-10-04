// The tabletop's public shape: what the renderer is told (grid, tokens, walls,
// fog, lights, previews) and what it reports back (picks in grid terms).
// renderer.ts implements it and re-exports these types.

import type * as THREE from 'three/webgpu';
import type { Cue, Shot } from '$lib/game/chat';
import type { GridEdge, GridPos, SquareGrid } from '$lib/game/grid';
import type { Ambient, Light } from '$lib/game/lights';
import type { Motion } from '$lib/game/motion';
import type { SceneObject } from '$lib/game/objects';
import type { Prop } from '$lib/game/props';
import type { Token } from '$lib/game/token';
import type { WorldLook } from '$lib/game/world';
import type { FogView } from '$lib/game/visibility';
import type { DiceThrow } from './dice3d';
import type { FogMode } from './fog';
import type { GridMode } from './grid-modes';
import type { Benchmark, PerfStats } from './perf';
import type { GridPose } from './poses';
import type { Caps, QualitySettings, Tier } from './quality';
import type { Pose } from './shots';

export type CameraView = 'tactical' | 'tabletop';
/** How a highlighted cell should read: a valid target, an invalid one, or a placement spot. */
export type HighlightKind = 'move' | 'blocked' | 'place';

/** Everything under the pointer, in grid terms. Fields are null when not applicable. */
export interface Pick {
	cell: GridPos | null;
	corner: GridPos | null;
	edge: GridEdge | null;
	/** Distance from the pointer to `edge`, in cells (0 = on the line). */
	edgeDistance: number;
	tokenId: string | null;
	objectId: string | null;
	/** A light fixture under the pointer. */
	lightId: string | null;
	/** A prop under the pointer. */
	propId: string | null;
}

export interface TabletopEvents {
	onClick(pick: Pick): void;
	onHover(pick: Pick | null): void;
}

/** Editor feedback drawn on the table: a wall/door outline or a corner marker. */
export type PreviewItem =
	| { kind: 'segment'; a: GridPos; b: GridPos; tone: 'valid' | 'invalid' | 'door' }
	| { kind: 'corner'; at: GridPos }
	/** A rectangle of cells, e.g. the area the GM is about to reveal or hide. */
	| { kind: 'area'; from: GridPos; to: GridPos; tone: 'reveal' | 'hide' | 'valid' | 'invalid' }
	/** A soft column of light over a cell: something a new player is shown to walk up to. */
	| { kind: 'beacon'; at: GridPos };

/** How a tabletop is set up. Every field is optional; the defaults are what the app uses. */
export interface TabletopOptions {
	/** The animation clock in ms. Default `performance.now()`; tests pass one they hold still. */
	now?: () => number;
	/** Default `min(devicePixelRatio, 2)`. */
	pixelRatio?: number;
	/** Keeps the drawn frame readable after it is shown (tests only: it costs memory; forces WebGL2). */
	preserveDrawingBuffer?: boolean;
	/** Overrides the `prefers-reduced-motion` media query when set. */
	reducedMotion?: boolean;
	/** `webgl` forces WebGPURenderer's WebGL2 backend; default: `?backend=` and the Graphics setting. */
	backend?: 'webgpu' | 'webgl';
	/** Records GPU timestamps, for `sampleGpu` and `benchmark` (`?perf`: normal play never pays). */
	perf?: boolean;
	/** Opens three.js's Inspector over the table (`?perf&inspector`), loaded only then. */
	inspector?: boolean;
	/** MSAA (default on). Fixed for the renderer's life: changing it takes a new tabletop. */
	antialias?: boolean;
	/**
	 * A renderer the lobby warmed up on this canvas (lobby.ts, #180), adopted instead of making
	 * one: its compiled shaders come with it. Its warm-up took `warmupMs`.
	 */
	warm?: { renderer: THREE.WebGPURenderer; warmupMs: number };
	/** The WebGL context or WebGPU device was lost: the tabletop draws no more (rebuild it). */
	onLost?: (info: { api: string; message: string }) => void;
	/** Refinement stepped an automatic tier down (see `setQuality`): remember it for this device. */
	onTierRefined?: (tier: Tier) => void;
	/**
	 * Dev only (the asset turntable, #194): hands over the scene to add meshes to, and a `redraw`
	 * that draws again with the sun's shadows. Never set by the app.
	 */
	devScene?: (scene: THREE.Scene, redraw: () => void) => void;
	/**
	 * Tests only: cells between baked probes (#235, default PROBE_SPACING), so a test that bakes
	 * them on SwiftShader lays a coarser lattice over the same table. Never set by the app.
	 */
	probeSpacing?: number;
}

export interface Tabletop {
	setGrid(grid: SquareGrid): void;
	setTokens(tokens: readonly Token[]): void;
	setObjects(objects: readonly SceneObject[]): void;
	setHoveredObject(objectId: string | null): void;
	setPreview(items: readonly PreviewItem[]): void;
	setFog(fog: FogView | null, mode: FogMode): void;
	/**
	 * The band (what the rules darken), the lights, and the world's look, whose hour blends the
	 * lighting presets with a sun (#208); without a look, the band's preset alone.
	 */
	setLighting(ambient: Ambient, lights: readonly Light[], world?: WorldLook | null): void;
	setProps(props: readonly Prop[]): void;
	/** Throws 3D dice for a roll. Returns ms until they have landed. */
	throwDice(t: DiceThrow): number;
	setSelectedProp(propId: string | null): void;
	setHoveredProp(propId: string | null): void;
	setSelected(tokenId: string | null): void;
	/**
	 * How much grid shows (#245, `GridMode`): local UI state, never synced. In explore mode the
	 * lines show round `focus` (the hovered cell, the selected token's). A uniform write.
	 */
	setGridMode(mode: GridMode, focus?: readonly (GridPos | null)[]): void;
	/** Lays these tokens down (fallen characters); stands the others up. */
	setFallen(tokenIds: readonly string[]): void;
	/** Marks the token whose turn it is in a fight (an enemy's in red), or none. */
	setActive(tokenId: string | null, enemy: boolean): void;
	/** Floats combat text (damage, healing, a status) up from a token. */
	showFloat(tokenId: string, text: string, color: string): void;
	/** The hovered cell's highlight, its kind told by colour and pattern (move, blocked, place). */
	setHighlight(cell: GridPos | null, kind: HighlightKind): void;
	/** Each cell's level (elevation), or null for a flat table. */
	setTerrain(levels: Uint8Array | null): void;
	/** What each cell is made of (`FLOOR_IDS`, drawn by the terrain kind), or null when nothing is painted. */
	setFloor(floor: Uint8Array | null): void;
	/** How the table looks (an environment asset's id), or null for the plain table. */
	setEnvironment(id: string | null): void;
	/** The table's dark areas (one byte per cell), or null for none. */
	setDarkness(mask: Uint8Array | null): void;
	/** The roofed cells (one byte per cell), or null for none: no sun under them (#219). */
	setInterior(mask: Uint8Array | null): void;
	/** Plays a cinematic moment; `swingPropId` is the bell to swing, if it is on the table. */
	playCue(cue: Cue, swingPropId: string | null): void;
	/** Points the camera at something for a moment (see shots.ts), then gives it back. */
	playShot(shot: Shot): void;
	/** Plays motions on props (a lever swinging, a chain shaking) and their sounds. */
	playMotions(motions: readonly Motion[]): void;
	setView(view: CameraView): void;
	/** Puts the camera at a pose at once, ending any shot or view change (tests, photo mode). */
	setPose(pose: Pose): void;
	/** Where the camera is now, to carry over to a rebuilt tabletop (`setPose`); null before a table framed it. */
	cameraPose(): Pose | null;
	/** The same, for a pose in grid terms (a fixture's named pose). */
	setGridPose(pose: GridPose): void;
	/**
	 * Applies a quality tier's settings (quality.ts): the pixel cap and the sun's shadow size
	 * for now. With `refine`, the first active frames after a table loads may step it down once.
	 */
	setQuality(settings: QualitySettings, refine?: boolean): void;
	/** What this device offers, as probed when the renderer started. */
	capabilities(): Caps;
	/** Power saver (the viewer's setting): no ambient animation (scheduler.ts). */
	setPowerSaver(on: boolean): void;
	/**
	 * Reduce flashing (the viewer's setting, `auto` already resolved against reduced motion): every
	 * flash a slow, dimmer fade (flash.ts `flashPolicy`). Uniforms only: nothing recompiles.
	 */
	setReduceFlashing(on: boolean): void;
	/** What rendering has cost so far (see perf.ts). */
	stats(): PerfStats;
	/** The loads the table's first view waits for (models.ts): [settled, started]. */
	loads(): [number, number];
	/** Draws the current view `frames` times, timing the main thread and the GPU (see perf.ts). */
	benchmark(frames: number): Promise<Benchmark>;
	/** Reads the GPU timestamps of the frames since the last call into `stats().gpuMs`. */
	sampleGpu(): Promise<void>;
	resetStats(): void;
	/**
	 * Stops and frees everything. Resolves once the renderer itself is gone: make the next tabletop
	 * only after that, since two renderers tearing down and starting up at once break each other.
	 */
	dispose(): Promise<void>;
}

/** Other changes that can move what casts a shadow (the camera, hover and highlights don't). */
export const RESHADOWS = [
	'setFallen',
	'setActive',
	'showFloat',
	'throwDice',
	'playMotions',
	'playCue',
	'setQuality'
] as const satisfies readonly (keyof Tabletop)[];

/** The updates whose cost is measured. */
export const TIMED = [
	'setGrid',
	'setTokens',
	'setObjects',
	'setProps',
	'setFog',
	'setLighting',
	'setDarkness',
	'setInterior',
	'setTerrain',
	'setFloor',
	'setEnvironment'
] as const satisfies readonly (keyof Tabletop)[];
