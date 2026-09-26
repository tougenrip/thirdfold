// The tabletop's public shape: what the renderer is told (grid, tokens, walls,
// fog, lights, previews) and what it reports back (picks in grid terms).
// renderer.ts implements it and re-exports these types.

import type { Cue, Shot } from '$lib/game/chat';
import type { GridEdge, GridPos, SquareGrid } from '$lib/game/grid';
import type { Ambient, Light } from '$lib/game/lights';
import type { Motion } from '$lib/game/motion';
import type { SceneObject } from '$lib/game/objects';
import type { Prop } from '$lib/game/props';
import type { Token } from '$lib/game/token';
import type { FogView } from '$lib/game/visibility';
import type { DiceThrow } from './dice3d';
import type { FogMode } from './fog';
import type { PerfStats } from './perf';
import type { GridPose } from './poses';
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
	/** Keeps the drawn frame readable after it is shown (tests only: it costs memory). */
	preserveDrawingBuffer?: boolean;
	/** Overrides the `prefers-reduced-motion` media query when set. */
	reducedMotion?: boolean;
}

export interface Tabletop {
	setGrid(grid: SquareGrid): void;
	setTokens(tokens: readonly Token[]): void;
	setObjects(objects: readonly SceneObject[]): void;
	setHoveredObject(objectId: string | null): void;
	setPreview(items: readonly PreviewItem[]): void;
	setFog(fog: FogView | null, mode: FogMode): void;
	setLighting(ambient: Ambient, lights: readonly Light[]): void;
	setProps(props: readonly Prop[]): void;
	/** Throws 3D dice for a roll. Returns ms until they have landed. */
	throwDice(t: DiceThrow): number;
	setSelectedProp(propId: string | null): void;
	setHoveredProp(propId: string | null): void;
	setSelected(tokenId: string | null): void;
	/** Lays these tokens down (fallen characters); stands the others up. */
	setFallen(tokenIds: readonly string[]): void;
	/** Marks the token whose turn it is in a fight (an enemy's in red), or none. */
	setActive(tokenId: string | null, enemy: boolean): void;
	/** Floats combat text (damage, healing, a status) up from a token. */
	showFloat(tokenId: string, text: string, color: string): void;
	setHighlight(cell: GridPos | null, kind: HighlightKind): void;
	/** Each cell's level (elevation), or null for a flat table. */
	setTerrain(levels: Uint8Array | null): void;
	/** What each cell is made of (see floor.ts), or null when nothing is painted. */
	setFloor(floor: Uint8Array | null): void;
	/** How the table looks (an environment asset's id), or null for the plain table. */
	setEnvironment(id: string | null): void;
	/** The table's dark areas (one byte per cell), or null for none. */
	setDarkness(mask: Uint8Array | null): void;
	/** Plays a cinematic moment; `swingPropId` is the bell to swing, if it is on the table. */
	playCue(cue: Cue, swingPropId: string | null): void;
	/** Points the camera at something for a moment (see shots.ts), then gives it back. */
	playShot(shot: Shot): void;
	/** Plays motions on props (a lever swinging, a chain shaking) and their sounds. */
	playMotions(motions: readonly Motion[]): void;
	setView(view: CameraView): void;
	/** Puts the camera at a pose at once, ending any shot or view change (tests, photo mode). */
	setPose(pose: Pose): void;
	/** The same, for a pose in grid terms (a fixture's named pose). */
	setGridPose(pose: GridPose): void;
	/** What rendering has cost so far (see perf.ts). */
	stats(): PerfStats;
	/**
	 * Draws the current view `frames` times, waiting for the GPU each time: the
	 * main thread's ms per frame (`cpu`) and the whole frame's until drawn (`gpu`).
	 */
	benchmark(frames: number): { cpu: number; gpu: number; drawCalls: number };
	/** GPU ms of the current view by timer queries (median of `frames`), or null without them. */
	timeFrames(frames: number): Promise<number | null>;
	resetStats(): void;
	dispose(): void;
}

/** Other changes that can move what casts a shadow (the camera, hover and highlights don't). */
export const RESHADOWS = [
	'setFallen',
	'setActive',
	'showFloat',
	'throwDice',
	'playMotions',
	'playCue'
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
	'setTerrain',
	'setFloor',
	'setEnvironment'
] as const satisfies readonly (keyof Tabletop)[];
