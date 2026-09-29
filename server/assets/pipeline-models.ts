// Models for the asset pipeline (pipeline.ts): assets/models/<kind>/, part
// lists baked into GLBs, or GLBs made elsewhere (meshes only) with an
// optional <id>.meta.json for their swing and whether they are a set piece.
// Each is held to its class's limits (LIMITS, by limitClass).

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
	LIMITS,
	MODEL_KINDS,
	limitClass,
	type MaterialDef,
	type ModelEntry
} from '../../src/lib/assets/manifest';
import { checkGlb, writeGlb } from './glb';
import { bakeModel, isModelKind, readModelSource } from './models';
import { AssetError, idOf, isRecord, list, readJson, type Emit } from './pipeline-files';

const ROLES = ['body', 'swing', 'accent'];

/**
 * What a GLB takes on the GPU: its binary chunk, which in a model of plain meshes is exactly
 * the vertex and index arrays (#185's validator counts them view by view once models are cooked).
 */
function glbGpuBytes(glb: Buffer): number {
	return glb.readUInt32LE(20 + glb.readUInt32LE(12));
}

const round = (v: number[]) =>
	v.map((n) => Math.round(n * 1000) / 1000) as [number, number, number];

export function buildModels(
	dir: string,
	emit: Emit,
	materials: Record<string, MaterialDef>
): Record<string, ModelEntry> {
	const materialColor = (id: string) => materials[id].color;
	const models: Record<string, ModelEntry> = {};
	const modelDir = path.join(dir, 'models');
	for (const kind of list(modelDir)) {
		if (!isModelKind(kind)) {
			throw new AssetError(
				path.join(modelDir, kind),
				`model folders are ${MODEL_KINDS.join(', ')}`
			);
		}
		const kindDir = path.join(modelDir, kind);
		for (const name of list(kindDir)) {
			const source = path.join(kindDir, name);
			const { id, ext } = idOf(name, kindDir);
			if (ext === 'meta.json') continue;
			if (id in models) throw new AssetError(source, 'a model with this id already exists');
			let glb: Buffer;
			let swing: ModelEntry['swing'];
			let setPiece = false;
			try {
				if (ext === 'json') {
					const model = readModelSource(readJson(source), new Set(Object.keys(materials)));
					glb = writeGlb(bakeModel(model, materialColor));
					swing = model.swing;
					setPiece = model.setPiece === true;
				} else if (ext === 'glb') {
					glb = readFileSync(source);
					const meta = path.join(kindDir, `${id}.meta.json`);
					if (existsSync(meta)) {
						const m = readJson(meta);
						if (isRecord(m) && isRecord(m.swing)) swing = m.swing as ModelEntry['swing'];
						setPiece = isRecord(m) && m.setPiece === true;
					}
				} else throw new Error('models are .json part lists or .glb files');
			} catch (err) {
				throw err instanceof AssetError ? err : new AssetError(source, (err as Error).message);
			}
			if (setPiece && kind !== 'prop') throw new AssetError(source, 'only a prop is a set piece');
			const checked = checkGlb(glb);
			if (!checked.ok) throw new AssetError(source, checked.error);
			const unknown = checked.info.meshes.filter((m) => !ROLES.includes(m));
			if (unknown.length) {
				throw new AssetError(
					source,
					`meshes must be named body, swing or accent (found ${unknown.join(', ')})`
				);
			}
			const limit = LIMITS[limitClass({ kind, setPiece })];
			const { triangles, bounds } = checked.info;
			if (triangles > limit.triangles) {
				throw new AssetError(source, `${triangles} triangles is more than ${limit.triangles}`);
			}
			if (glb.length > limit.bytes) throw new AssetError(source, 'file too large');
			const gpuBytes = glbGpuBytes(glb);
			if (gpuBytes > limit.gpuBytes) throw new AssetError(source, 'too large on the GPU');
			// Part lists have no LODs: a few hundred triangles need none.
			models[id] = {
				...emit('models', id, 'glb', glb),
				bytes: glb.length,
				kind,
				triangles,
				bounds: { min: round(bounds.min), max: round(bounds.max) },
				gpuBytes,
				...(swing ? { swing } : {}),
				...(setPiece ? { setPiece: true as const } : {})
			};
		}
	}
	return models;
}
