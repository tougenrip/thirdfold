// What every stage of the asset pipeline (pipeline.ts) shares: reading
// source folders, naming the source that is wrong, and emitting built files
// named by their content.

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ASSET_ID_PATTERN } from '../../src/lib/assets/manifest';

/** A problem with one source, naming it. */
export class AssetError extends Error {
	constructor(source: string, message: string) {
		super(`${source}: ${message}`);
	}
}

export const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

/** A built file: its path under the output folder, and its whole SHA-256. */
export interface Emitted {
	file: string;
	sha256: string;
}

/** Adds a built file, named `<folder>/<id>.<first 8 hex of its digest>.<ext>`. */
export type Emit = (folder: string, id: string, ext: string, data: Buffer) => Emitted;

export function emitter(files: Map<string, Buffer>): Emit {
	return (folder, id, ext, data) => {
		const sha256 = createHash('sha256').update(data).digest('hex');
		const file = `${folder}/${id}.${sha256.slice(0, 8)}.${ext}`;
		files.set(file, data);
		return { file, sha256 };
	};
}

/** Files in a folder (none if it doesn't exist), sorted so builds are stable. */
export function list(dir: string): string[] {
	return existsSync(dir) ? readdirSync(dir).sort() : [];
}

export function readJson(file: string): unknown {
	try {
		return JSON.parse(readFileSync(file, 'utf8'));
	} catch (err) {
		throw new AssetError(file, `not valid JSON (${(err as Error).message})`);
	}
}

/** Splits `name.ext` into an asset id and extension, refusing ids that aren't asset ids. */
export function idOf(file: string, dir: string): { id: string; ext: string } {
	const match = /^(.+?)\.([a-z0-9.]+)$/.exec(file);
	if (!match || !ASSET_ID_PATTERN.test(match[1])) {
		throw new AssetError(
			path.join(dir, file),
			'file names must be an asset id (a-z, 0-9, -) and an extension'
		);
	}
	return { id: match[1], ext: match[2] };
}
