// What a client was sent about a region it has never explored, read from its
// raw frames (#175). Every material samples per-cell maps built from what the
// client was sent, so "unexplored is black" is only honest if no frame carries
// anything about those cells: this decodes every per-viewer render input with
// the shared decoders and names each leak by frame and field. Not a spec file
// itself; game-server.spec.ts runs it for a player and a spectator, and for the
// GM as the control (whose frames must leak every field, so the check can fire).
//
// The per-viewer render inputs checked, from snapshots (welcome, room_reset) and
// diffs: fog (visible, explored), terrain, floor, darkness, interior (#203), lights, tokens,
// props, walls and doors, environment (a public id only), and the markers (a
// secret's name, id or colour) in any frame at all, the log included. Later
// milestones add theirs here: world look (#199), last-seen
// lights (#204), token looks (#202), VFX sources and attacker ids (#314) and
// camera shots (#355).

import { decodeFloor } from '../src/lib/game/floor';
import type { GridPos, SquareGrid } from '../src/lib/game/grid';
import type { Light } from '../src/lib/game/lights';
import { cellsBeside, unitEdges, type SceneObject } from '../src/lib/game/objects';
import { footprintCells, type Prop } from '../src/lib/game/props';
import { decodeMask, type FogView } from '../src/lib/game/visibility';
import type { RoomSnapshot, ServerMessage } from '../src/lib/game/protocol';
import { decodeLevels } from '../src/lib/game/terrain';
import type { Token } from '../src/lib/game/token';

/** Cells from (x0, y0) to (x1, y1), inclusive. */
export interface Region {
	x0: number;
	y0: number;
	x1: number;
	y1: number;
}

export interface Leak {
	/** The frame: its index and type. */
	where: string;
	/** The field that carried it (`terrain`, `lights`, `marker:<text>`, …). */
	field: string;
	detail: string;
}

export function framesLeaks(
	frames: readonly string[],
	grid: SquareGrid,
	region: Region,
	markers: readonly string[]
): Leak[] {
	const size = grid.width * grid.height;
	const inside = (c: GridPos) =>
		c.x >= region.x0 && c.x <= region.x1 && c.y >= region.y0 && c.y <= region.y1;
	const cells: number[] = [];
	for (let y = region.y0; y <= region.y1; y++) {
		for (let x = region.x0; x <= region.x1; x++) cells.push(y * grid.width + x);
	}
	const leaks: Leak[] = [];
	let where = '';
	const leak = (field: string, detail: string) => leaks.push({ where, field, detail });

	const cellName = (i: number) => `(${i % grid.width}, ${Math.floor(i / grid.width)})`;
	/** A per-cell map must be zero across the region (and decode at all). */
	const map = (field: string, values: ArrayLike<number> | null) => {
		if (!values) return leak(field, 'does not decode');
		const set = cells.filter((i) => values[i]);
		if (set.length) leak(field, `${set.length} cells set, first at ${cellName(set[0])}`);
	};
	const at = (field: string, pos: GridPos, id: string) => {
		if (inside(pos)) leak(field, `${id} at (${pos.x}, ${pos.y})`);
	};
	const fog = (f: FogView) => {
		if (!f.enabled) return leak('fog', 'fog is off: everything is sent');
		map('fog.visible', decodeMask(f.visible, size));
		map('fog.explored', decodeMask(f.explored, size));
	};
	const terrain = (t: string | null) => t !== null && map('terrain', decodeLevels(t, size));
	const floor = (f: string | null) => f !== null && map('floor', decodeFloor(f, size));
	const darkness = (d: string | null) => d !== null && map('darkness', decodeMask(d, size));
	const interior = (d: string | null) => d !== null && map('interior', decodeMask(d, size));
	const lights = (ls: Light[]) => ls.forEach((l) => at('lights', l.pos, l.id));
	const tokens = (ts: Token[]) => ts.forEach((t) => at('tokens', t.pos, t.id));
	// Props and walls are sent whole once any cell of theirs is known, so only one wholly
	// inside the region is a leak.
	const props = (ps: Prop[]) => {
		for (const p of ps) if (footprintCells(p).every(inside)) leak('props', p.id);
	};
	const objects = (os: SceneObject[]) => {
		for (const o of os) {
			const beside = unitEdges(o.a, o.b).flatMap((e) => cellsBeside(grid, e));
			if (beside.every(inside)) leak('objects', o.id);
		}
	};
	const environment = (e: unknown) => {
		if (e !== null && typeof e !== 'string') leak('environment', JSON.stringify(e));
	};
	const snapshot = (room: RoomSnapshot) => {
		fog(room.fog);
		terrain(room.terrain);
		floor(room.floor);
		darkness(room.darkness);
		interior(room.interior);
		lights(room.lights);
		tokens(room.tokens);
		props(room.props);
		objects(room.objects);
		environment(room.environment);
	};

	frames.forEach((frame, n) => {
		const msg = JSON.parse(frame) as ServerMessage;
		where = `frame ${n} (${msg.type})`;
		for (const m of markers) if (frame.includes(m)) leak(`marker:${m}`, 'in the frame');
		switch (msg.type) {
			case 'welcome':
			case 'room_reset':
				return snapshot(msg.room);
			case 'fog_update':
				return fog(msg.fog);
			case 'terrain_update':
				return terrain(msg.terrain);
			case 'floor_update':
				return floor(msg.floor);
			case 'darkness_update':
				return darkness(msg.darkness);
			case 'interior_update':
				return interior(msg.interior);
			case 'lights_changed':
				return lights(msg.upserted);
			case 'props_changed':
				return props(msg.upserted);
			case 'objects_changed':
				return objects(msg.upserted);
			case 'token_upserted':
				return tokens([msg.token]);
			case 'token_moved':
				return at('tokens', msg.pos, msg.tokenId);
			case 'environment_update': {
				const extra = Object.keys(msg).filter((k) => k !== 'type' && k !== 'environment');
				if (extra.length) leak('environment', `carries ${extra.join(', ')}`);
				return environment(msg.environment);
			}
		}
	});
	return leaks;
}
