// The rules band has one writer (#200): `lookWorld` in scene-look.ts sets the world
// and the band it decides, so the hour and the band never disagree. This scans
// every non-test source under server/ (fixtures and perf included) and the
// scripts for any other assignment to `.ambient` or `.world`.

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '..');

function sources(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true, recursive: true })
		.filter((e) => e.isFile() && /\.(ts|mjs)$/.test(e.name) && !/\.(spec|test)\.ts$/.test(e.name))
		.map((e) => path.relative(ROOT, path.join(e.parentPath, e.name)));
}

describe('the rules band', () => {
	it('is written only by scene-look.ts', () => {
		const files = [...sources(path.join(ROOT, 'server')), ...sources(path.join(ROOT, 'scripts'))];
		expect(files).toContain(path.join('server', 'scene-look.ts'));
		const writers = files.filter((file) => {
			const source = readFileSync(path.join(ROOT, file), 'utf8');
			return /\.(ambient|world)\s*=(?!=)/.test(source);
		});
		expect(writers).toEqual([path.join('server', 'scene-look.ts')]);
	});
});
