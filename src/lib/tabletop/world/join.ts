// Meshes of the world's builders joined into one: the whole table's ground, for the invariant
// harness (invariants.ts) and the specs. Pure.

import { DEFAULT_CHASM, type Chasm } from './chasm';
import { chunkGround, type GroundMesh } from './ground-mesh';
import { chunksAcross, type WorldShape } from './shape';

/** Meshes joined into one (the whole table's ground, for the harness). */
export function joinMeshes(meshes: readonly GroundMesh[]): GroundMesh {
	const size = (f: (m: GroundMesh) => ArrayLike<number>) =>
		meshes.reduce((n, m) => n + f(m).length, 0);
	const out: GroundMesh = {
		positions: new Float32Array(size((m) => m.positions)),
		normals: new Float32Array(size((m) => m.normals)),
		indices: new Uint32Array(size((m) => m.indices)),
		owners: new Int32Array(size((m) => m.owners))
	};
	let [v, i] = [0, 0];
	for (const m of meshes) {
		out.positions.set(m.positions, v * 3);
		out.normals.set(m.normals, v * 3);
		out.owners.set(m.owners, v);
		out.indices.set(
			m.indices.map((x) => x + v),
			i
		);
		v += m.owners.length;
		i += m.indices.length;
	}
	return out;
}

/** Every chunk's ground, tops, sides and the void's floor (#243), as one mesh. */
export function tableGround(shape: WorldShape, chasm: Chasm = DEFAULT_CHASM): GroundMesh {
	const across = chunksAcross(shape.grid);
	const parts: GroundMesh[] = [];
	for (let c = 0; c < across.x * across.y; c++) {
		const { top, sides, bottom } = chunkGround(shape, c, null, 0, chasm);
		parts.push(top, sides, bottom);
	}
	return joinMeshes(parts);
}
