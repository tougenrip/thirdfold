// Picking: turns pointer positions into what is under them, in grid terms
// (cell, corner, nearest edge, token, wall or door, light fixture, prop), and
// pointer input into clicks and hover changes. A press that moves more than
// CLICK_SLOP_PX is a camera drag, not a click.

import * as THREE from 'three';
import {
	cornerToWorld,
	worldToCorner,
	worldToEdge,
	worldToGrid,
	type SquareGrid
} from '$lib/game/grid';
import type { LightingLayer } from './lighting';
import type { PerfRecorder } from './perf';
import type { PropLayer } from './props';
import type { TerrainLayer } from './terrain';
import type { TokenLayer } from './tokens';
import type { Pick, TabletopEvents } from './types';
import type { WallLayer } from './walls';

/** Pointer travel (px) below which a press-release counts as a click rather than a camera drag. */
export const CLICK_SLOP_PX = 6;

export interface PickLayers {
	tokens: TokenLayer;
	walls: WallLayer;
	lighting: LightingLayer;
	props: PropLayer;
	terrain: TerrainLayer;
}

/** A key that changes exactly when the hover should be reported again. */
export function pickKey(p: Pick): string {
	const e = p.edge ? `${p.edge.a.x},${p.edge.a.y},${p.edge.b.x},${p.edge.b.y}` : '';
	return [
		p.cell?.x,
		p.cell?.y,
		p.corner?.x,
		p.corner?.y,
		e,
		p.edgeDistance < 0.2,
		p.tokenId,
		p.objectId,
		p.lightId,
		p.propId
	].join('|');
}

export class Picker {
	private raycaster = new THREE.Raycaster();
	private pointer = new THREE.Vector2();
	private tablePlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
	private hitPoint = new THREE.Vector3();

	constructor(
		private readonly canvas: HTMLCanvasElement,
		private readonly camera: THREE.Camera,
		private readonly layers: PickLayers,
		private readonly grid: () => SquareGrid | null
	) {}

	/** What is under a pointer position: things first (tokens, walls, lights, props), then ground. */
	at(event: { clientX: number; clientY: number }): Pick {
		const { raycaster, layers, hitPoint } = this;
		const rect = this.canvas.getBoundingClientRect();
		this.pointer.set(
			((event.clientX - rect.left) / rect.width) * 2 - 1,
			-((event.clientY - rect.top) / rect.height) * 2 + 1
		);
		raycaster.setFromCamera(this.pointer, this.camera);
		const tokenId = layers.tokens.pick(raycaster);
		const objectId = tokenId ? null : layers.walls.pick(raycaster);
		const lightId = tokenId || objectId ? null : layers.lighting.pick(raycaster);
		const propId = tokenId || objectId || lightId ? null : layers.props.pick(raycaster);
		const pick: Pick = {
			cell: null,
			corner: null,
			edge: null,
			edgeDistance: Infinity,
			tokenId,
			objectId,
			lightId,
			propId
		};
		const grid = this.grid();
		if (!grid) return pick;
		// Raised ground first: pointing at a balcony picks the balcony, not the floor under it.
		const raised = layers.terrain.pick(raycaster);
		const onPlane = raycaster.ray.intersectPlane(this.tablePlane, hitPoint);
		if (
			raised &&
			(!onPlane ||
				raised.point.distanceTo(raycaster.ray.origin) <= onPlane.distanceTo(raycaster.ray.origin))
		) {
			hitPoint.copy(raised.point);
			pick.cell = { x: raised.cell % grid.width, y: Math.floor(raised.cell / grid.width) };
		} else if (onPlane) {
			pick.cell = worldToGrid(grid, hitPoint);
		} else {
			return pick;
		}
		pick.corner = worldToCorner(grid, hitPoint);
		pick.edge = worldToEdge(grid, hitPoint);
		if (pick.edge) {
			const a = cornerToWorld(grid, pick.edge.a);
			const vertical = pick.edge.a.x === pick.edge.b.x;
			pick.edgeDistance = Math.abs(vertical ? hitPoint.x - a.x : hitPoint.z - a.z) / grid.cellSize;
		}
		return pick;
	}
}

/**
 * Reports clicks and hover changes on the canvas as picks. Pressing or
 * scrolling calls `onTakeHold` (the viewer took the camera). Returns a
 * function that stops listening.
 */
export function listenForPicks(
	canvas: HTMLCanvasElement,
	picker: Picker,
	events: TabletopEvents,
	perf: PerfRecorder,
	onTakeHold: () => void
): () => void {
	let press: { x: number; y: number } | null = null;
	let hoverKey = '';

	const onPointerDown = (event: PointerEvent) => {
		onTakeHold();
		press = event.button === 0 ? { x: event.clientX, y: event.clientY } : null;
	};
	const onPointerUp = (event: PointerEvent) => {
		if (!press || event.button !== 0) return;
		const moved = Math.hypot(event.clientX - press.x, event.clientY - press.y);
		press = null;
		if (moved > CLICK_SLOP_PX) return;
		events.onClick(picker.at(event));
	};
	const onPointerMove = (event: PointerEvent) => {
		if (event.buttons !== 0) return; // dragging the camera
		const pick = perf.time('pick', () => picker.at(event));
		canvas.style.cursor = pick.tokenId || pick.objectId ? 'pointer' : '';
		const key = pickKey(pick);
		if (key === hoverKey) return;
		hoverKey = key;
		events.onHover(pick);
	};
	const onPointerLeave = () => {
		if (hoverKey === '') return;
		hoverKey = '';
		events.onHover(null);
	};

	canvas.addEventListener('pointerdown', onPointerDown);
	canvas.addEventListener('wheel', onTakeHold, { passive: true });
	canvas.addEventListener('pointerup', onPointerUp);
	canvas.addEventListener('pointermove', onPointerMove);
	canvas.addEventListener('pointerleave', onPointerLeave);
	return () => {
		canvas.removeEventListener('pointerdown', onPointerDown);
		canvas.removeEventListener('wheel', onTakeHold);
		canvas.removeEventListener('pointerup', onPointerUp);
		canvas.removeEventListener('pointermove', onPointerMove);
		canvas.removeEventListener('pointerleave', onPointerLeave);
	};
}
