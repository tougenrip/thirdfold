// The stone-halls pilot kit (#263), made in house the way the great bell's pilot was (#196) until
// docs/ART.md's brief B is commissioned: the trim sheet's three maps as PNG and every piece as the
// GLB a Blender export would be (one `body` mesh, UVs on the sheet, no textures of its own), each
// with its meta.json; then assets/kits/stone-halls.json, the greybox kit (stone-halls-greybox.json,
// scripts/make-kits.ts) with the pilot's pieces in every role they fill. Same bytes every run on
// Node 22 (PNG deflate differs under other zlibs):
//   npx tsx scripts/make-kits.ts
//   npx -y node@22 node_modules/tsx/dist/cli.mjs scripts/make-stone-halls-art.ts
// then `npm run assets:cook` and `npm run assets`. The GLBs and PNGs are gitignored; only the
// meta.json files are committed (docs/ASSETS.md, "The stone-halls pilot kit").

import { Document, NodeIO } from '@gltf-transform/core';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { format, resolveConfig } from 'prettier';
import type * as THREE from 'three';
import { json } from '../server/assets/pipeline-files';
import { encodePng } from '../server/assets/png';
import { pieceGeometry, type Piece } from './stone-halls/build';
import { pilotPieces } from './stone-halls/pieces';
import { SIZE, paintTrim } from './stone-halls/trim';

/** The manifest material every piece wears: the trim sheet (assets/materials.json). */
export const TRIM = 'ashlar-trim';
const PROVENANCE = {
	license: 'LicenseRef-thirdfold-original',
	author: 'thirdfold contributors',
	modified: false
};
const GREYBOX = path.join('assets', 'kits', 'stone-halls-greybox.json');
const KIT = path.join('assets', 'kits', 'stone-halls.json');
/** The floors the pilot's flags pave; the planks and terracotta stay the greybox's. */
const FLAG_FLOORS = ['plain', 'flagstone', 'stone'];

// As prettier lays it out (`json`), so `npm run format` never changes a source the cook pinned.
const meta = (value: object) => json({ provenance: PROVENANCE, ...value });
function write(dir: string, file: string, data: Uint8Array | string) {
	mkdirSync(dir, { recursive: true });
	writeFileSync(path.join(dir, file), data);
}

// ---------------------------------------------------------------- the trim sheet

const maps = paintTrim();
for (const [usage, rgba] of Object.entries(maps)) {
	const id = `${TRIM}-${usage}`;
	const dir = path.join('art', 'texture', id);
	write(dir, `${id}.png`, encodePng(SIZE, SIZE, rgba, 'sub'));
	write(dir, 'meta.json', meta({ usage }));
}

// ---------------------------------------------------------------- the pieces

function glb(geometry: THREE.BufferGeometry): Promise<Uint8Array> {
	const doc = new Document();
	const buffer = doc.createBuffer();
	const attr = (key: string, type: 'VEC2' | 'VEC3') =>
		doc
			.createAccessor()
			.setBuffer(buffer)
			.setType(type)
			.setArray(new Float32Array(geometry.getAttribute(key).array));
	const index = geometry.getIndex()!.array;
	const prim = doc
		.createPrimitive()
		.setAttribute('POSITION', attr('position', 'VEC3'))
		.setAttribute('NORMAL', attr('normal', 'VEC3'))
		.setAttribute('TEXCOORD_0', attr('uv', 'VEC2'))
		.setAttribute('COLOR_0', attr('color', 'VEC3'))
		.setIndices(
			doc.createAccessor().setBuffer(buffer).setType('SCALAR').setArray(new Uint16Array(index))
		)
		.setMaterial(doc.createMaterial(TRIM).setRoughnessFactor(0.85).setMetallicFactor(0));
	// Blender names mesh data apart from its object: the cook renames it to the node's role.
	doc
		.createScene('Scene')
		.addChild(doc.createNode('body').setMesh(doc.createMesh('body.001').addPrimitive(prim)));
	return new NodeIO().writeBinary(doc);
}

const pieces = pilotPieces();
for (const piece of pieces) {
	const dir = path.join('art', 'kit', piece.id);
	write(dir, `${piece.id}.glb`, await glb(pieceGeometry(piece, maps.albedo)));
	// Simplified seams stay closed (lockBorder); the trim sheet comes with the material.
	write(dir, 'meta.json', meta({ materials: [TRIM], lockBorder: true }));
}

// ---------------------------------------------------------------- the kit

type Entry = { model: string; weight?: number };
const entry = (p: Piece): Entry => ({ model: p.id, ...(p.weight ? { weight: p.weight } : {}) });
const kit = JSON.parse(readFileSync(GREYBOX, 'utf8'));
kit.name = 'Stone halls';
const byRole = new Map<string, Entry[]>();
for (const p of pieces) byRole.set(p.role, [...(byRole.get(p.role) ?? []), entry(p)]);
for (const [role, list] of byRole) if (!role.startsWith('floor.')) kit.pieces[role] = list;
for (const floor of FLAG_FLOORS)
	kit.floors[floor] = { tiles: byRole.get('floor.tiles'), broken: byRole.get('floor.broken') };
const config = (await resolveConfig(KIT)) ?? {};
writeFileSync(KIT, await format(JSON.stringify(kit), { ...config, parser: 'json' }));

console.log(`Wrote the trim sheet (${SIZE}²), ${pieces.length} pieces and ${KIT}`);
