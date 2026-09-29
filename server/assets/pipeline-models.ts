// Models for the asset pipeline (pipeline.ts): assets/models/<kind>/, part
// lists baked into GLBs, or GLBs made elsewhere or cooked (checked by
// checkGlb: meshes, materials and KTX2 textures only) with an optional
// <id>.meta.json for their swing and whether they are a set piece. Each is
// held to its class's limits (LIMITS, by limitClass).

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
import { creditOf, provenanceFor } from './licence';
import { bakeModel, isModelKind, readModelSource } from './models';
import { AssetError, checkMeta, idOf, isRecord, list, readJson, type Emit } from './pipeline-files';

const round = (v: number[]) =>
	v.map((n) => Math.round(n * 1000) / 1000) as [number, number, number];

export async function buildModels(
	dir: string,
	emit: Emit,
	materials: Record<string, MaterialDef>
): Promise<Record<string, ModelEntry>> {
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
			if (ext === 'meta.json') {
				checkMeta(kindDir, id, 'glb');
				continue;
			}
			if (Object.hasOwn(models, id))
				throw new AssetError(source, 'a model with this id already exists');
			let glb: Buffer;
			let swing: ModelEntry['swing'];
			let setPiece = false;
			let screenSizes: unknown;
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
						if (isRecord(m)) screenSizes = m.screenSizes;
					}
				} else throw new Error('models are .json part lists or .glb files');
			} catch (err) {
				throw err instanceof AssetError ? err : new AssetError(source, (err as Error).message);
			}
			const credit = creditOf(provenanceFor(kindDir, id, ext));
			if (setPiece && kind !== 'prop') throw new AssetError(source, 'only a prop is a set piece');
			const limit = LIMITS[limitClass({ kind, setPiece })];
			const checked = await checkGlb(glb, limit);
			if (!checked.ok) throw new AssetError(source, checked.error);
			const { triangles, bounds, gpuBytes } = checked.info;
			// Part lists have no LODs: a few hundred triangles need none. A cooked model's meta.json
			// says below what share of the screen each level is drawn (cook.ts).
			const lods = checked.info.lods.map((t, i) => ({
				triangles: t,
				screenSize: Array.isArray(screenSizes) ? screenSizes[i] : undefined
			}));
			if (lods.some((l) => typeof l.screenSize !== 'number')) {
				throw new AssetError(source, 'a model with LODs needs their screenSizes in its meta.json');
			}
			models[id] = {
				...emit('models', id, 'glb', glb),
				bytes: glb.length,
				kind,
				triangles,
				bounds: { min: round(bounds.min), max: round(bounds.max) },
				gpuBytes,
				credit,
				...(swing ? { swing } : {}),
				...(lods.length ? { lods: lods as ModelEntry['lods'] } : {}),
				...(checked.info.cooked ? { cooked: true as const } : {}),
				...(setPiece ? { setPiece: true as const } : {})
			};
		}
	}
	return models;
}
