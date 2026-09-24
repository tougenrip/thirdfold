// Binary glTF (GLB) for models: writing what the pipeline bakes, and
// checking what an author provides. Models are meshes and nothing else:
// no scripts (glTF has none, but extensions could bring anything), no
// extensions, no external or data URIs, no images, cameras, skins or
// animations. What passes can be loaded by three.js's GLTFLoader as plain
// geometry.

/** One mesh of a model: `body`, `swing` (the parts that swing) or `accent` (tinted with the token's colour). */
export interface MeshData {
	name: string;
	positions: Float32Array;
	/** Per-vertex normals, or none: the client works them out (every hard edge has its own vertices). */
	normals: Float32Array | null;
	/** Linear RGB per vertex (0..1), or none (white). */
	colors: Float32Array | null;
	indices: Uint16Array | Uint32Array;
}

const MAGIC = 0x46546c67; // 'glTF'
const JSON_CHUNK = 0x4e4f534a; // 'JSON'
const BIN_CHUNK = 0x004e4942; // 'BIN\0'
const FLOAT = 5126;
const UNSIGNED_SHORT = 5123;
const UNSIGNED_INT = 5125;
const ARRAY_BUFFER = 34962;
const ELEMENT_ARRAY_BUFFER = 34963;

const pad4 = (n: number) => (n + 3) & ~3;

/** A GLB holding these meshes, each on its own node. */
export function writeGlb(meshes: readonly MeshData[]): Buffer {
	const views: { buffer: 0; byteOffset: number; byteLength: number; target: number }[] = [];
	const accessors: Record<string, unknown>[] = [];
	const chunks: Buffer[] = [];
	let offset = 0;
	const add = (data: ArrayBufferView, target: number): number => {
		const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
		const length = pad4(bytes.length);
		chunks.push(Buffer.concat([bytes, Buffer.alloc(length - bytes.length)]));
		views.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, target });
		offset += length;
		return views.length - 1;
	};
	const glMeshes = meshes.map((m) => {
		const count = m.positions.length / 3;
		const min = [Infinity, Infinity, Infinity];
		const max = [-Infinity, -Infinity, -Infinity];
		for (let i = 0; i < m.positions.length; i++) {
			min[i % 3] = Math.min(min[i % 3], m.positions[i]);
			max[i % 3] = Math.max(max[i % 3], m.positions[i]);
		}
		const attributes: Record<string, number> = {};
		accessors.push({
			bufferView: add(m.positions, ARRAY_BUFFER),
			componentType: FLOAT,
			count,
			type: 'VEC3',
			min,
			max
		});
		attributes.POSITION = accessors.length - 1;
		if (m.normals) {
			accessors.push({
				bufferView: add(m.normals, ARRAY_BUFFER),
				componentType: FLOAT,
				count,
				type: 'VEC3'
			});
			attributes.NORMAL = accessors.length - 1;
		}
		if (m.colors) {
			// Normalised 16-bit RGBA: precise enough in the darks, where 8 bits band.
			const rgba = new Uint16Array(count * 4);
			for (let i = 0; i < count; i++) {
				for (let c = 0; c < 3; c++) {
					rgba[i * 4 + c] = Math.round(Math.min(Math.max(m.colors[i * 3 + c], 0), 1) * 65535);
				}
				rgba[i * 4 + 3] = 65535;
			}
			accessors.push({
				bufferView: add(rgba, ARRAY_BUFFER),
				componentType: UNSIGNED_SHORT,
				normalized: true,
				count,
				type: 'VEC4'
			});
			attributes.COLOR_0 = accessors.length - 1;
		}
		accessors.push({
			bufferView: add(m.indices, ELEMENT_ARRAY_BUFFER),
			componentType: m.indices instanceof Uint16Array ? UNSIGNED_SHORT : UNSIGNED_INT,
			count: m.indices.length,
			type: 'SCALAR'
		});
		return { name: m.name, primitives: [{ attributes, indices: accessors.length - 1, mode: 4 }] };
	});
	const bin = Buffer.concat(chunks);
	const json = {
		asset: { version: '2.0', generator: 'thirdfold asset pipeline' },
		scene: 0,
		scenes: [{ nodes: meshes.map((_, i) => i) }],
		nodes: meshes.map((m, i) => ({ name: m.name, mesh: i })),
		meshes: glMeshes,
		accessors,
		bufferViews: views,
		buffers: [{ byteLength: bin.length }]
	};
	const jsonBytes = Buffer.from(JSON.stringify(json), 'utf8');
	const jsonChunk = Buffer.concat([
		jsonBytes,
		Buffer.alloc(pad4(jsonBytes.length) - jsonBytes.length, 0x20)
	]);
	const header = Buffer.alloc(12);
	const total = 12 + 8 + jsonChunk.length + 8 + bin.length;
	header.writeUInt32LE(MAGIC, 0);
	header.writeUInt32LE(2, 4);
	header.writeUInt32LE(total, 8);
	const chunkHeader = (length: number, type: number) => {
		const h = Buffer.alloc(8);
		h.writeUInt32LE(length, 0);
		h.writeUInt32LE(type, 4);
		return h;
	};
	return Buffer.concat([
		header,
		chunkHeader(jsonChunk.length, JSON_CHUNK),
		jsonChunk,
		chunkHeader(bin.length, BIN_CHUNK),
		bin
	]);
}

export interface GlbInfo {
	meshes: string[];
	triangles: number;
	bounds: { min: [number, number, number]; max: [number, number, number] };
}

/** Top-level glTF properties a model may have. Anything else (extensions, images, animations...) is refused. */
const ALLOWED = new Set([
	'asset',
	'scene',
	'scenes',
	'nodes',
	'meshes',
	'accessors',
	'bufferViews',
	'buffers',
	'materials'
]);
const ALLOWED_ATTRIBUTES = new Set(['POSITION', 'NORMAL', 'COLOR_0', 'TEXCOORD_0']);

type Checked = { ok: true; info: GlbInfo } | { ok: false; error: string };

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

/** Whether `data` is a GLB made only of meshes, and what it holds. */
export function checkGlb(data: Buffer): Checked {
	const bad = (error: string): Checked => ({ ok: false, error });
	if (data.length < 20 || data.readUInt32LE(0) !== MAGIC) return bad('not a GLB file');
	if (data.readUInt32LE(4) !== 2) return bad('not glTF 2.0');
	if (data.readUInt32LE(8) !== data.length) return bad('length does not match');
	const jsonLength = data.readUInt32LE(12);
	if (data.readUInt32LE(16) !== JSON_CHUNK || 20 + jsonLength > data.length) {
		return bad('no JSON chunk first');
	}
	let json: unknown;
	try {
		json = JSON.parse(data.subarray(20, 20 + jsonLength).toString('utf8'));
	} catch {
		return bad('JSON chunk does not parse');
	}
	if (!isRecord(json)) return bad('JSON chunk is not an object');
	for (const key of Object.keys(json)) {
		if (!ALLOWED.has(key)) return bad(`"${key}" is not allowed in a model`);
	}
	const binStart = 20 + jsonLength;
	const binLength = binStart + 8 <= data.length ? data.readUInt32LE(binStart) : 0;
	if (binStart + 8 > data.length || data.readUInt32LE(binStart + 4) !== BIN_CHUNK) {
		return bad('no binary chunk');
	}
	if (binStart + 8 + binLength !== data.length) return bad('trailing or missing data');
	const buffers = json.buffers;
	if (!Array.isArray(buffers) || buffers.length !== 1 || !isRecord(buffers[0])) {
		return bad('a model has exactly one buffer');
	}
	if ('uri' in buffers[0]) return bad('buffers must be embedded, not linked');
	if (buffers[0].byteLength !== undefined && (buffers[0].byteLength as number) > binLength) {
		return bad('buffer longer than its chunk');
	}
	// Nothing anywhere may point outside the file or bring in extensions.
	const text = JSON.stringify(json);
	if (/"uri"\s*:/.test(text)) return bad('external or data URIs are not allowed');
	if (/"extensions(Used|Required)?"\s*:/.test(text)) return bad('extensions are not allowed');
	// Materials may be there (they are ignored), but not the textures they would load.
	if (/"\w*[tT]exture"\s*:/.test(text)) return bad('textures inside a model are not allowed');
	// Materials may be there (they are ignored), but not the textures they would load.
	if (/"\w*[tT]exture"\s*:/.test(text)) return bad('textures inside a model are not allowed');

	const accessors = Array.isArray(json.accessors) ? json.accessors : [];
	const views = Array.isArray(json.bufferViews) ? json.bufferViews : [];
	for (const v of views) {
		if (!isRecord(v) || v.buffer !== 0) return bad('bad buffer view');
		const end = ((v.byteOffset as number) ?? 0) + (v.byteLength as number);
		if (!Number.isInteger(end) || end > binLength) return bad('buffer view past the data');
	}
	const meshes = Array.isArray(json.meshes) ? json.meshes : [];
	const nodes = Array.isArray(json.nodes) ? json.nodes : [];
	if (meshes.length === 0) return bad('no meshes');
	let triangles = 0;
	const min: [number, number, number] = [Infinity, Infinity, Infinity];
	const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
	for (const mesh of meshes) {
		if (!isRecord(mesh) || !Array.isArray(mesh.primitives)) return bad('bad mesh');
		for (const p of mesh.primitives) {
			if (!isRecord(p) || !isRecord(p.attributes)) return bad('bad primitive');
			if ((p.mode ?? 4) !== 4) return bad('only triangles');
			for (const name of Object.keys(p.attributes)) {
				if (!ALLOWED_ATTRIBUTES.has(name)) return bad(`attribute ${name} is not allowed`);
			}
			const position = accessors[p.attributes.POSITION as number];
			if (!isRecord(position) || !Array.isArray(position.min) || !Array.isArray(position.max)) {
				return bad('positions need their bounds');
			}
			for (let i = 0; i < 3; i++) {
				min[i] = Math.min(min[i], position.min[i] as number);
				max[i] = Math.max(max[i], position.max[i] as number);
			}
			const index = typeof p.indices === 'number' ? accessors[p.indices] : null;
			const count = isRecord(index) ? (index.count as number) : (position.count as number);
			triangles += Math.floor(count / 3);
		}
	}
	if (![...min, ...max].every(Number.isFinite)) return bad('bad bounds');
	return {
		ok: true,
		info: {
			meshes: nodes.flatMap((n) => (isRecord(n) && typeof n.name === 'string' ? [n.name] : [])),
			triangles,
			bounds: { min, max }
		}
	};
}
