// Models for the asset pipeline (pipeline.ts): assets/models/<kind>/, part
// lists baked into GLBs, or GLBs made elsewhere or cooked (checked by
// checkGlb: meshes, materials and KTX2 textures only) with an optional
// <id>.meta.json for their swing, whether they are a set piece and their pack
// (#192: a look, never a story place; `core` by default). An <id>.preview.json
// part list is a model's preview (#192): a light stand-in the client shows
// until the full model arrives. Each is held to its class's limits (LIMITS,
// by limitClass). A model may have a thumbnail, assets/thumbnails/<id>.png,
// rendered by scripts/thumbnails.mjs.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
	ASSET_ID_PATTERN,
	LIMITS,
	MODEL_KINDS,
	THUMBNAIL_BYTES,
	limitClass,
	readPoses,
	type ModelPoses,
	type FileInfo,
	type MaterialDef,
	type ModelEntry
} from '../../src/lib/assets/manifest';
import { checkGlb, writeGlb } from './glb';
import { creditOf, provenanceFor } from './licence';
import { bakeModel, isModelKind, readModelSource } from './models';
import { pngSize } from './png';
import { AssetError, checkMeta, idOf, isRecord, list, readJson, type Emit } from './pipeline-files';

/** The pack a model downloads with unless its meta.json names one (#192). */
export const CORE_PACK = 'core';

/** To a thousandth, and never -0, which JSON writes as 0. */
const round = (v: number[]) =>
	v.map((n) => Math.round(n * 1000) / 1000 || 0) as [number, number, number];

export async function buildModels(
	dir: string,
	emit: Emit,
	materials: Record<string, MaterialDef>
): Promise<Record<string, ModelEntry>> {
	const materialColor = (id: string) => materials[id].color;
	const known = new Set(Object.keys(materials));
	const models: Record<string, ModelEntry> = {};
	const previews: [string, string][] = [];
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
			if (ext === 'preview.json') {
				previews.push([kindDir, id]);
				continue;
			}
			if (Object.hasOwn(models, id))
				throw new AssetError(source, 'a model with this id already exists');
			let glb: Buffer;
			let swing: ModelEntry['swing'];
			let setPiece = false;
			let translucency: number | undefined;
			let screenSizes: unknown;
			let posesRaw: unknown;
			let pack = CORE_PACK;
			let worn: string[] | undefined;
			try {
				if (ext === 'json') {
					const model = readModelSource(readJson(source), known);
					glb = writeGlb(bakeModel(model, materialColor));
					swing = model.swing;
					setPiece = model.setPiece === true;
					translucency = model.translucency;
				} else if (ext === 'glb') {
					glb = readFileSync(source);
					const meta = path.join(kindDir, `${id}.meta.json`);
					if (existsSync(meta)) {
						const m = readJson(meta);
						if (isRecord(m) && isRecord(m.swing)) swing = m.swing as ModelEntry['swing'];
						setPiece = isRecord(m) && m.setPiece === true;
						if (isRecord(m)) screenSizes = m.screenSizes;
						if (isRecord(m)) posesRaw = m.poses;
						if (isRecord(m) && m.pack !== undefined) {
							if (typeof m.pack !== 'string' || !ASSET_ID_PATTERN.test(m.pack))
								throw new AssetError(meta, 'a pack is an asset id');
							pack = m.pack;
						}
						// A kit piece's trim sheet comes with the materials it wears (#263).
						if (isRecord(m) && m.materials !== undefined) {
							const list = m.materials;
							if (!Array.isArray(list) || !list.every((x) => typeof x === 'string' && known.has(x)))
								throw new AssetError(meta, 'materials must name materials in materials.json');
							worn = list as string[];
						}
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
			// Poses (#273): a figure's, each meaning a pose the file has, and every pose meant.
			let poses: ModelPoses | null = null;
			if (posesRaw !== undefined || checked.info.poses.length) {
				poses = kind === 'prop' ? null : readPoses(posesRaw, checked.info.poses);
				const meant = new Set(Object.values(poses ?? {}));
				if (!poses || checked.info.poses.some((p) => !meant.has(p as 1 | 2 | 3)))
					throw new AssetError(
						source,
						`poses: a figure's meta.json names what each of its poses (${checked.info.poses.join(', ') || 'none'}) is for: downed or active`
					);
			}
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
				...(poses ? { poses } : {}),
				...(lods.length ? { lods: lods as ModelEntry['lods'] } : {}),
				...(checked.info.cooked ? { cooked: true as const } : {}),
				...(setPiece ? { setPiece: true as const } : {}),
				...(translucency ? { translucency } : {}),
				...(worn ? { materials: worn } : {}),
				pack
			};
		}
	}
	for (const [kindDir, id] of previews) {
		const source = path.join(kindDir, `${id}.preview.json`);
		const model = models[id];
		if (!model) throw new AssetError(source, 'a preview needs its model beside it');
		let glb: Buffer;
		try {
			glb = writeGlb(bakeModel(readModelSource(readJson(source), known), materialColor));
		} catch (err) {
			throw new AssetError(source, (err as Error).message);
		}
		// Held to its model's class, and never heavier than the model it stands in for.
		const checked = await checkGlb(glb, LIMITS[limitClass(model)]);
		if (!checked.ok) throw new AssetError(source, checked.error);
		if (glb.length >= model.bytes)
			throw new AssetError(source, 'a preview must be lighter than its model');
		const credit = creditOf(provenanceFor(kindDir, id, 'preview.json'));
		model.preview = { ...emit('previews', id, 'glb', glb), bytes: glb.length, credit };
	}
	const thumbDir = path.join(dir, 'thumbnails');
	for (const name of list(thumbDir)) {
		const { id, ext } = idOf(name, thumbDir);
		if (ext === 'meta.json') checkMeta(thumbDir, id, 'png');
		else if (ext !== 'png' || !Object.hasOwn(models, id))
			throw new AssetError(path.join(thumbDir, name), 'thumbnails are <model id>.png');
		else models[id].thumbnail = thumbnail(thumbDir, id, emit);
	}
	return models;
}

/** A model's thumbnail (#194): a small PNG with its own provenance. */
function thumbnail(dir: string, id: string, emit: Emit): FileInfo {
	const source = path.join(dir, `${id}.png`);
	const png = readFileSync(source);
	if (!pngSize(png)) throw new AssetError(source, 'not a PNG');
	if (png.length > THUMBNAIL_BYTES)
		throw new AssetError(source, `${png.length} bytes, over ${THUMBNAIL_BYTES} for a thumbnail`);
	const credit = creditOf(provenanceFor(dir, id, 'png'));
	return { ...emit('thumbs', id, 'png', png), bytes: png.length, credit };
}
