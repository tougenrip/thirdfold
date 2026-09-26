// Editor feedback drawn on the table: wall and door outlines, corner markers,
// areas about to be revealed or hidden, the beacon a new player is shown to,
// and the highlighted cell. They reuse a few geometries and materials; only
// transforms change.

import * as THREE from 'three';
import { cornerToWorld, gridToWorld, type GridPos, type SquareGrid } from '$lib/game/grid';
import type { Ground } from './ground';
import type { HighlightKind, PreviewItem } from './types';
import { WALL_HEIGHT } from './walls';

const HIGHLIGHT = { move: 0xe0a458, blocked: 0xe27a6b, place: 0x7fc47a } satisfies Record<
	HighlightKind,
	number
>;

export class PreviewLayer {
	readonly group = new THREE.Group();
	readonly highlight: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
	private box = new THREE.BoxGeometry(1, 1, 1);
	private corner = new THREE.CylinderGeometry(0.12, 0.12, 0.3, 16);
	private beaconColumn = new THREE.CylinderGeometry(0.32, 0.42, 1, 24, 1, true);
	private beaconRing = new THREE.RingGeometry(0.36, 0.48, 32);
	private materials = {
		valid: new THREE.MeshBasicMaterial({ color: 0x7fc47a, transparent: true, opacity: 0.55 }),
		invalid: new THREE.MeshBasicMaterial({ color: 0xe27a6b, transparent: true, opacity: 0.55 }),
		door: new THREE.MeshBasicMaterial({ color: 0xe0a458, transparent: true, opacity: 0.7 }),
		reveal: new THREE.MeshBasicMaterial({ color: 0xf2e6d0, transparent: true, opacity: 0.25 }),
		hide: new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45 }),
		beacon: new THREE.MeshBasicMaterial({
			color: 0x9fd7ff,
			transparent: true,
			opacity: 0.22,
			side: THREE.DoubleSide,
			depthWrite: false
		}),
		beaconRing: new THREE.MeshBasicMaterial({
			color: 0xbfe6ff,
			transparent: true,
			opacity: 0.8,
			side: THREE.DoubleSide,
			depthWrite: false
		})
	};

	constructor() {
		this.group.renderOrder = 2;
		this.highlight = new THREE.Mesh(
			new THREE.PlaneGeometry(0.94, 0.94),
			new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.35, depthWrite: false })
		);
		this.highlight.rotation.x = -Math.PI / 2;
		this.highlight.visible = false;
		this.highlight.renderOrder = 2; // above the fog overlay
	}

	set(items: readonly PreviewItem[], grid: SquareGrid | null, ground: Ground | null): void {
		const { group, materials } = this;
		group.clear();
		if (!grid) return;
		const size = grid.cellSize;
		for (const item of items) {
			if (item.kind === 'area') {
				const a = gridToWorld(grid, item.from);
				const b = gridToWorld(grid, item.to);
				const area = new THREE.Mesh(this.box, materials[item.tone]);
				area.position.set((a.x + b.x) / 2, 0.02 * size, (a.z + b.z) / 2);
				area.scale.set(Math.abs(b.x - a.x) + size, 0.04 * size, Math.abs(b.z - a.z) + size);
				group.add(area);
				continue;
			}
			if (item.kind === 'beacon') {
				const w = gridToWorld(grid, item.at);
				const floor = ground?.floorY(item.at) ?? 0;
				const column = new THREE.Mesh(this.beaconColumn, materials.beacon);
				column.position.set(w.x, floor + 1.1 * size, w.z);
				column.scale.set(size, 2.2 * size, size);
				const ring = new THREE.Mesh(this.beaconRing, materials.beaconRing);
				ring.rotation.x = -Math.PI / 2;
				ring.position.set(w.x, floor + 0.03 * size, w.z);
				ring.scale.setScalar(size);
				group.add(column, ring);
				continue;
			}
			if (item.kind === 'corner') {
				const w = cornerToWorld(grid, item.at);
				const marker = new THREE.Mesh(this.corner, materials.valid);
				marker.position.set(w.x, 0.15 * size, w.z);
				marker.scale.setScalar(size);
				group.add(marker);
				continue;
			}
			const p = cornerToWorld(grid, item.a);
			const q = cornerToWorld(grid, item.b);
			const length = Math.hypot(q.x - p.x, q.z - p.z);
			const height = WALL_HEIGHT * size * (item.tone === 'door' ? 0.9 : 0.5);
			const box = new THREE.Mesh(this.box, materials[item.tone]);
			box.position.set((p.x + q.x) / 2, height / 2, (p.z + q.z) / 2);
			box.rotation.y = Math.atan2(-(q.z - p.z), q.x - p.x);
			box.scale.set(length + 0.12 * size, height, 0.18 * size);
			group.add(box);
		}
	}

	setHighlight(
		cell: GridPos | null,
		kind: HighlightKind,
		grid: SquareGrid | null,
		ground: Ground | null
	): void {
		const { highlight } = this;
		if (cell && grid) {
			const w = gridToWorld(grid, cell);
			highlight.position.set(w.x, (ground?.floorY(cell) ?? 0) + 0.04, w.z);
			highlight.scale.setScalar(grid.cellSize);
			highlight.material.color.setHex(HIGHLIGHT[kind]);
		}
		highlight.visible = !!(cell && grid);
	}

	dispose(): void {
		this.group.clear();
		for (const g of [this.box, this.corner, this.beaconColumn, this.beaconRing]) g.dispose();
		Object.values(this.materials).forEach((m) => m.dispose());
		this.highlight.geometry.dispose();
		this.highlight.material.dispose();
	}
}
