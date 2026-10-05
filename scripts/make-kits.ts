// Writes the greybox architecture kits (#261): assets/models/kit/<kit>-<piece>.json part lists and
// assets/kits/<kit>.json, one kit per built-in environment, from the shapes in scripts/kits/ and
// each kit's look. Deterministic: the same files on every run. Run it, then `npm run assets`:
//   npx tsx scripts/make-kits.ts
// Pieces sit at their role's pivot inside its envelope (src/lib/assets/kit.ts, docs/ASSETS.md
// "Architecture kits"); the build refuses one that doesn't. Docs: docs/ASSETS.md "Greybox kits".

import { readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { format, resolveConfig } from 'prettier';
import { STYLES } from './kits/looks';
import { buildKit, type Piece } from './kits/pieces';

const ROOT = 'assets';
const MODELS = path.join(ROOT, 'models', 'kit');

const config = (await resolveConfig(path.join(ROOT, 'kits', 'plain.json'))) ?? {};
const write = async (file: string, value: unknown) =>
	writeFileSync(file, await format(JSON.stringify(value), { ...config, parser: 'json' }));

// Every piece is written again; one a look no longer has goes from the folder.
for (const name of readdirSync(MODELS))
	if (name.endsWith('.json') && !name.startsWith('_')) rmSync(path.join(MODELS, name));

for (const style of STYLES) {
	const kit = buildKit(style);
	const written = new Map<Piece, string>();
	const model = async (p: Piece) => {
		if (!written.has(p)) {
			const id = `${style.id}-${p.id}`;
			await write(path.join(MODELS, `${id}.json`), { parts: p.parts });
			written.set(p, id);
		}
		return written.get(p)!;
	};
	const pieces: Record<string, unknown[]> = {};
	for (const [role, list] of Object.entries(kit.pieces)) {
		pieces[role] = [];
		for (const p of list)
			pieces[role].push({
				model: await model(p),
				...(p.weight ? { weight: p.weight } : {}),
				...(p.sockets ? { sockets: p.sockets } : {})
			});
	}
	const floors: Record<string, { tiles: unknown[]; broken: unknown[] }> = {};
	for (const [floor, f] of Object.entries(kit.floors)) {
		floors[floor] = { tiles: [], broken: [] };
		for (const p of f.tiles) floors[floor].tiles.push({ model: await model(p) });
		for (const p of f.broken) floors[floor].broken.push({ model: await model(p) });
	}
	const def = {
		name: style.name,
		roof: style.roof ?? null,
		presumeRoofs: !!style.presumeRoofs,
		pieces,
		floors
	};
	await write(path.join(ROOT, 'kits', `${style.id}.json`), def);
}
