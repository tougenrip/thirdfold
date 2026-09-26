// Writes the fixture tables and their per-viewer views (milestone 61):
//
//   npx tsx server/fixtures/build.ts             compositions, stress tables, views
//   npx tsx server/fixtures/build.ts --refreeze  also rebuilds the frozen adventure tables
//
// tests/fixtures/scenes/<name>.json is a scene file, <name>.poses.json its
// named camera poses; tests/fixtures/views/<name>.<band>.json is what the GM,
// a fogged player and a spectator are sent in that band. The frozen adventure
// tables are only rewritten on purpose, so a story change never moves them.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SceneFile } from '../../src/lib/game/scene-file';
import { compositions, type Fixture, type FixtureSidecar } from './compositions';
import { frozenFixtures } from './frozen';
import { BANDS, fixtureViews } from './views';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const SCENES_DIR = path.join(ROOT, 'tests/fixtures/scenes');
export const VIEWS_DIR = path.join(ROOT, 'tests/fixtures/views');

export const json = (value: unknown) => JSON.stringify(value, null, '\t') + '\n';

/** Every file the fixtures produce, by path relative to ROOT, from the given fixtures. */
export function fixtureFiles(fixtures: Record<string, Fixture>): Map<string, string> {
	const files = new Map<string, string>();
	for (const [name, { scene, sidecar }] of Object.entries(fixtures)) {
		files.set(`tests/fixtures/scenes/${name}.json`, json(scene));
		files.set(`tests/fixtures/scenes/${name}.poses.json`, json(sidecar));
		for (const band of BANDS) {
			files.set(
				`tests/fixtures/views/${name}.${band}.json`,
				json(fixtureViews(name, scene, sidecar, band))
			);
		}
	}
	return files;
}

/** The committed fixtures, read back from disk. */
export function committedFixtures(): Record<string, Fixture> {
	const out: Record<string, Fixture> = {};
	if (!existsSync(SCENES_DIR)) return out;
	for (const file of readdirSync(SCENES_DIR).sort()) {
		if (!file.endsWith('.json') || file.endsWith('.poses.json')) continue;
		const name = file.slice(0, -'.json'.length);
		out[name] = {
			scene: JSON.parse(readFileSync(path.join(SCENES_DIR, file), 'utf8')) as SceneFile,
			sidecar: JSON.parse(
				readFileSync(path.join(SCENES_DIR, `${name}.poses.json`), 'utf8')
			) as FixtureSidecar
		};
	}
	return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
	const refreeze = process.argv.includes('--refreeze');
	const committed = committedFixtures();
	const frozen = refreeze
		? frozenFixtures()
		: Object.fromEntries(Object.entries(committed).filter(([n]) => !(n in compositions())));
	const fixtures = { ...frozen, ...compositions() };
	mkdirSync(SCENES_DIR, { recursive: true });
	mkdirSync(VIEWS_DIR, { recursive: true });
	for (const [file, text] of fixtureFiles(fixtures)) writeFileSync(path.join(ROOT, file), text);
	console.log(`Wrote ${Object.keys(fixtures).length} fixtures to tests/fixtures.`);
}
