import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SHIPPED } from './credits';

describe('the shipped code and fonts', () => {
	it('carry the licence their packages state', () => {
		const npm = SHIPPED.filter((s) => s.pkg);
		expect(npm.length).toBeGreaterThan(5);
		for (const s of npm) {
			const json = JSON.parse(readFileSync(`node_modules/${s.pkg}/package.json`, 'utf8'));
			expect(json.license, s.name).toBe(s.license);
		}
	});

	it('list the decoders three.js vendors, where it keeps them', () => {
		for (const file of [
			'basis/basis_transcoder.js',
			'meshopt_decoder.module.js',
			'ktx-parse.module.js'
		]) {
			expect(() => readFileSync(`node_modules/three/examples/jsm/libs/${file}`)).not.toThrow();
		}
		expect(SHIPPED.map((s) => s.name)).toEqual(
			expect.arrayContaining(['Basis Universal transcoder', 'meshoptimizer decoder', 'ktx-parse'])
		);
	});
});
