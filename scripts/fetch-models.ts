// The CC0 bridge props (#262, docs/ASSETS.md "CC0 bridge props"): Poly Haven models fetched by
// pinned URL and SHA-256 into art/<kind>/<id>/, which git ignores but for each meta.json, then
// put together as the export the cook expects (<id>.glb): one `body` mesh, flattened, simplified
// to `triangles` (within `error`), turned `turn` quarter turns about y and scaled to `fit` (x, y, z in cells; a null
// axis takes the smallest scale given), its base at y 0 and its footprint centred; one material
// whose baseColor is the colour map darkened by the scan's occlusion (`arm`'s red, at most
// `AO_STRENGTH`), no metal, `roughness` (0.8 by default). The cook then recolours that map through
// the meta's `ramp` (docs/ART.md "Palette and values") and encodes it.
// The meta's provenance.source is the glTF; `maps` lists the buffer, the colour map and the ARM
// map, each with its URL and SHA-256. By hand, never in CI, under Node 22 (PNG deflate bytes):
//
//   npx -y node@22 node_modules/tsx/dist/cli.mjs scripts/fetch-models.ts [id...]
//   ... --record   write the hash of a file whose meta has none (all zeros)
//
// Only Poly Haven and ambientCG are fetched from (the owner's sources for #262).

import { Document, NodeIO, type Mesh, type mat4 } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
	flatten,
	getBounds,
	join,
	prune,
	simplify,
	transformMesh,
	weld
} from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { decodePng, encodePng } from '../server/assets/png';

const ART = 'art';
const HOSTS = new Set(['dl.polyhaven.org', 'ambientcg.com']);
const UNPINNED = '0'.repeat(64);
/** How much darker the scan's occlusion may make the colour map (docs/ART.md section 4: 20%). */
const AO_STRENGTH = 0.2;
const KEEP = new Set(['POSITION', 'NORMAL', 'TEXCOORD_0']);

interface Pinned {
	url: string;
	sha256: string;
}
interface ModelMeta {
	provenance: { source?: Pinned };
	maps?: Pinned[];
	fit: (number | null)[];
	turn?: number;
	triangles: number;
	/** The simplifier's error limit, a share of the mesh's size (0.02 by default). */
	error?: number;
	roughness?: number;
}

const record = process.argv.includes('--record');
const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const sha256 = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
const nameOf = (url: string) => path.basename(new URL(url).pathname);

/** One pinned file, fetched into `dir` unless it is there with its hash; null if it fails. */
async function fetchPinned(
	dir: string,
	file: Pinned,
	save: () => void
): Promise<Uint8Array | null> {
	const url = new URL(file.url);
	if (!HOSTS.has(url.hostname)) {
		console.error(`${dir}: ${file.url} is not Poly Haven or ambientCG`);
		return null;
	}
	const local = path.join(dir, nameOf(file.url));
	let data: Uint8Array | null = existsSync(local) ? readFileSync(local) : null;
	if (!data || sha256(data) !== file.sha256) {
		console.log(`${dir}: fetching ${file.url}`);
		const res = await fetch(file.url, { headers: { 'User-Agent': 'thirdfold' } });
		if (!res.ok) {
			console.error(`${dir}: ${res.status} ${res.statusText}`);
			return null;
		}
		data = new Uint8Array(await res.arrayBuffer());
		writeFileSync(local, data);
	}
	const got = sha256(data);
	if (file.sha256 === UNPINNED && record) {
		file.sha256 = got;
		save();
	} else if (got !== file.sha256) {
		console.error(`${dir}: ${file.url}'s SHA-256 is ${got}, not ${file.sha256}; removed`);
		rmSync(local);
		return null;
	}
	return data;
}

// Column-major 4×4 matrices, as glTF's.
type Mat4 = mat4;
const scaleTranslate = (s: number[], t: number[]): Mat4 => [
	s[0],
	0,
	0,
	0,
	0,
	s[1],
	0,
	0,
	0,
	0,
	s[2],
	0,
	t[0],
	t[1],
	t[2],
	1
];
/** `turns` quarter turns about +y. */
function quarterTurns(turns: number): Mat4 {
	const q = ((turns % 4) + 4) % 4;
	const [c, s] = [
		[1, 0],
		[0, 1],
		[-1, 0],
		[0, -1]
	][q];
	return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
}

/** The colour map darkened by the ARM map's occlusion (red), at most AO_STRENGTH. */
function albedo(diff: Uint8Array, arm: Uint8Array | null): Uint8Array {
	const color = decodePng(diff);
	if (arm) {
		const ao = decodePng(arm);
		if (ao.width !== color.width || ao.height !== color.height)
			throw new Error('the colour and ARM maps differ in size');
		const k = Math.round(AO_STRENGTH * 256);
		for (let i = 0; i < color.width * color.height; i++) {
			const dark = ((255 - ao.data[i * 4]) * k) >> 8; // 0-51 of 255
			for (let c = 0; c < 3; c++) {
				const v = color.data[i * 4 + c];
				color.data[i * 4 + c] = v - ((v * dark) >> 8);
			}
		}
	}
	for (let i = 0; i < color.width * color.height; i++) color.data[i * 4 + 3] = 255;
	return encodePng(color.width, color.height, color.data);
}

/** The export the cook expects, from the fetched glTF, its buffer and maps. */
async function assemble(
	io: NodeIO,
	files: Map<string, Uint8Array>,
	gltfName: string,
	meta: ModelMeta
): Promise<Uint8Array> {
	const json = JSON.parse(new TextDecoder().decode(files.get(gltfName)));
	// The glTF's own JPEG maps aren't fetched: the PNGs replace them.
	const resources: Record<string, Uint8Array<ArrayBuffer>> = {};
	for (const b of json.buffers ?? [])
		resources[b.uri] = new Uint8Array(files.get(path.basename(b.uri))!);
	for (const img of json.images ?? []) resources[img.uri] = new Uint8Array(0);
	const doc: Document = await io.readJSON({ json, resources });
	const root = doc.getRoot();
	for (const t of root.listTextures()) t.dispose();
	for (const e of root.listExtensionsUsed()) e.dispose();
	if (root.listMaterials().length !== 1) throw new Error('needs exactly one material');
	if (root.listSkins().length || root.listAnimations().length)
		throw new Error('no skins or animations');
	for (const c of root.listCameras()) c.dispose();

	await doc.transform(flatten(), join({ keepNamed: false }), prune());
	const meshes = root.listNodes().filter((n) => n.getMesh());
	if (meshes.length !== 1) throw new Error(`${meshes.length} meshes after joining, not 1`);
	const node = meshes[0];
	const mesh: Mesh = node.getMesh()!;
	for (const prim of mesh.listPrimitives()) {
		if (!prim.getAttribute('NORMAL')) throw new Error('a primitive without normals');
		for (const s of prim.listSemantics()) if (!KEEP.has(s)) prim.setAttribute(s, null);
	}
	// Simplified to about `triangles`.
	const count = mesh
		.listPrimitives()
		.reduce((n, p) => n + (p.getIndices()?.getCount() ?? 0) / 3, 0);
	await doc.transform(weld());
	if (count > meta.triangles) {
		await doc.transform(
			simplify({
				simplifier: MeshoptSimplifier,
				ratio: meta.triangles / count,
				error: meta.error ?? 0.02
			})
		);
	}

	// Turned, then scaled to fit and set on the floor, centred on its footprint.
	transformMesh(mesh, quarterTurns(meta.turn ?? 0));
	const before = getBounds(node);
	const size = [0, 1, 2].map((a) => before.max[a] - before.min[a]);
	const given = meta.fit.map((f, a) => (f === null ? null : f / size[a]));
	const least = Math.min(...given.filter((s): s is number => s !== null));
	const scale = given.map((s) => s ?? least);
	const centre = [0, 1, 2].map((a) => (before.max[a] + before.min[a]) / 2);
	transformMesh(
		mesh,
		scaleTranslate(scale, [-centre[0] * scale[0], -before.min[1] * scale[1], -centre[2] * scale[2]])
	);
	node.setName('body').setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
	mesh.setName('body');
	for (const scene of root.listScenes()) {
		for (const child of scene.listChildren()) if (child !== node) child.dispose();
		if (!scene.listChildren().includes(node)) scene.addChild(node);
	}

	// One material: the colour map, no metal, a painted roughness.
	const [diff, arm] = (meta.maps ?? []).slice(1).map((m) => files.get(nameOf(m.url)) ?? null);
	if (!diff) throw new Error('the colour map is missing');
	const texture = doc
		.createTexture('albedo')
		.setImage(albedo(diff, arm ?? null))
		.setMimeType('image/png');
	root
		.listMaterials()[0]
		.setName('body')
		.setBaseColorTexture(texture)
		.setBaseColorFactor([1, 1, 1, 1])
		.setMetallicFactor(0)
		.setRoughnessFactor(meta.roughness ?? 0.8)
		.setAlphaMode('OPAQUE')
		.setDoubleSided(false);
	await doc.transform(prune());
	const after = getBounds(node);
	console.log(
		`  ${count} → ${mesh.listPrimitives().reduce((n, p) => n + (p.getIndices()?.getCount() ?? 0) / 3, 0)} triangles, ` +
			`size ${[0, 1, 2].map((a) => (after.max[a] - after.min[a]).toFixed(2)).join(' × ')}` +
			` (source ${size.map((v) => v.toFixed(2)).join(' × ')} after the turn)`
	);
	return io.writeBinary(doc);
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
await MeshoptSimplifier.ready;
let failed = false;
for (const kind of readdirSync(ART).filter((k) => k !== 'surfaces' && k !== 'texture')) {
	for (const id of readdirSync(path.join(ART, kind)).sort()) {
		const dir = path.join(ART, kind, id);
		const metaFile = path.join(dir, 'meta.json');
		if (!existsSync(metaFile) || (only.length && !only.includes(id))) continue;
		const meta = JSON.parse(readFileSync(metaFile, 'utf8')) as ModelMeta;
		const source = meta.provenance.source;
		if (!source || !meta.maps) continue; // not fetched (the great bell is made by a script)
		const save = () => writeFileSync(metaFile, `${JSON.stringify(meta, null, '\t')}\n`);
		const files = new Map<string, Uint8Array>();
		let ok = true;
		for (const file of [source, ...meta.maps]) {
			const data = await fetchPinned(dir, file, save);
			if (data) files.set(nameOf(file.url), data);
			else ok = false;
		}
		if (!ok) {
			failed = true;
			continue;
		}
		try {
			console.log(`${kind}/${id}:`);
			writeFileSync(
				path.join(dir, `${id}.glb`),
				await assemble(io, files, nameOf(source.url), meta)
			);
		} catch (err) {
			console.error(`${dir}: ${(err as Error).message}`);
			failed = true;
		}
	}
}
if (failed) process.exit(1);
