// Skies (#213): assets/skies/<id>.json, each a sky preset (manifest.ts
// `SkyDef`) with its own "provenance", which may only be ours (a text source).
// Procedural, so nothing is emitted: each goes into the manifest inline.

import path from 'node:path';
import type { SkyDef } from '../../src/lib/assets/manifest';
import { parseSky } from '../../src/lib/assets/sky-parse';
import { checkBandContract, presetOf } from '../../src/lib/tabletop/atmosphere-curve';
import { ORIGINAL, creditOf, readProvenance } from './licence';
import { AssetError, idOf, isRecord, list, readJson } from './pipeline-files';

/** Every sky under `dir`/skies, checked. */
export function buildSkies(dir: string): Record<string, SkyDef> {
	const skies: Record<string, SkyDef> = {};
	const skyDir = path.join(dir, 'skies');
	for (const name of list(skyDir)) {
		const source = path.join(skyDir, name);
		const { id, ext } = idOf(name, skyDir);
		if (ext !== 'json') throw new AssetError(source, 'skies are .json');
		const raw = readJson(source);
		if (!isRecord(raw)) throw new AssetError(source, 'not an object');
		const provenance = readProvenance(raw.provenance, source);
		if (provenance.license !== ORIGINAL) {
			throw new AssetError(source, `a sky's provenance may only grant ${ORIGINAL}`);
		}
		const parsed = parseSky(raw);
		if (!parsed.ok) throw new AssetError(source, parsed.error);
		// A sky that contradicts the rules' bands (day with the sun down, stars by day) is refused.
		const broken = checkBandContract(presetOf(parsed.sky));
		if (broken.length) throw new AssetError(source, broken.join('; '));
		skies[id] = { ...parsed.sky, credit: creditOf(provenance) };
	}
	return skies;
}
