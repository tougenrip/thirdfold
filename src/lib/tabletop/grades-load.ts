// An environment's colour grades (#162), loaded a tone mapper at a time: a chunk of its own,
// which environment.ts imports when an environment has a grade (post.ts and grade.ts use the
// type only), so the renderer chunk stays in its budget.

import type { EnvironmentDef, FileInfo, GradeBand, ToneMapper } from '$lib/assets/manifest';
import { fetchAsset } from '$lib/assets/load';
import { LUT_SIZE } from './environment';

/** A built file: where it is and its digest. */
type Built = Pick<FileInfo, 'file' | 'sha256'>;

/**
 * A grade strip (1024×32: 32 slices of 32×32 side by side, blue choosing the slice, red across,
 * green down) as a 3D table in Data3DTexture order. Black is forced to exactly black: a browser
 * that perturbs canvas reads against fingerprinting must not lift unexplored cells (#161).
 */
async function loadGrade({ file, sha256 }: Built): Promise<Uint8Array> {
	const blob = new Blob([await fetchAsset(file, sha256)], { type: 'image/png' });
	const bitmap = await createImageBitmap(blob, { colorSpaceConversion: 'none' });
	const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
	const ctx = canvas.getContext('2d')!;
	ctx.drawImage(bitmap, 0, 0);
	const strip = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
	const n = LUT_SIZE;
	const out = new Uint8Array(n * n * n * 4);
	for (let b = 0; b < n; b++)
		for (let g = 0; g < n; g++)
			for (let r = 0; r < n; r++) {
				const from = (g * n * n + b * n + r) * 4;
				out.set(strip.subarray(from, from + 4), ((b * n + g) * n + r) * 4);
			}
	out.fill(0, 0, 3);
	return out;
}

/**
 * An environment's grades, loaded a tone mapper at a time (its three bands) the first time
 * that tone mapper is wanted: the rest wait for the viewer to pick them, so a table's first
 * frame fetches 3 strips, not all 9.
 */
export class Grades {
	/** The tone mappers loaded so far: their grades by band, or null if they failed to load. */
	readonly ready: Partial<Record<ToneMapper, Record<GradeBand, Uint8Array> | null>> = {};
	private readonly loading = new Map<ToneMapper, Promise<void>>();

	constructor(
		private readonly lut: NonNullable<EnvironmentDef['lut']>,
		private readonly files: Record<string, Built>
	) {}

	/** Loads a tone mapper's grades, once; resolves when they are in `ready`. */
	load(tm: ToneMapper): Promise<void> {
		let loading = this.loading.get(tm);
		if (!loading) {
			const bands = Object.entries(this.lut[tm]);
			loading = Promise.all(
				bands.map(async ([band, id]) => [band, await loadGrade(this.files[id])] as const)
			)
				.then((loaded) => Object.fromEntries(loaded) as Record<GradeBand, Uint8Array>)
				.catch(() => null)
				.then((set) => void (this.ready[tm] = set));
			this.loading.set(tm, loading);
		}
		return loading;
	}
}

const gradeCache = new Map<string, Grades>();

/** An environment's grades (one Grades per environment), with `toneMapper`'s loaded. */
export async function gradesOf(
	id: string,
	lut: NonNullable<EnvironmentDef['lut']>,
	files: Record<string, Built>,
	toneMapper: ToneMapper
): Promise<Grades> {
	let grades = gradeCache.get(id);
	if (!grades) gradeCache.set(id, (grades = new Grades(lut, files)));
	await grades.load(toneMapper);
	return grades;
}
