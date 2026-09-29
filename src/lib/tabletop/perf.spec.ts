import { describe, expect, it } from 'vitest';
import { byPass, passOf } from './perf';

describe('GPU time by pass (#166)', () => {
	it("groups three's render names into the pipeline's passes", () => {
		const cases: Record<string, string> = {
			prepass: 'prepass',
			scene: 'scene',
			overlay: 'overlay',
			'SSAO.AO': 'ao',
			'SSAO.Blur': 'ao',
			AO: 'ao',
			TRAA: 'traa',
			'Sharpen [ RCAS ]': 'traa',
			'SMAANode.edges': 'smaa',
			'SMAANode.blend': 'smaa',
			'DoF [ CoC ]': 'dof',
			'DoF [ Composite ]': 'dof',
			'Gaussian Blur [ Horizontal Pass ]': 'blur',
			'Bloom [ High Pass ]': 'bloom',
			'Render Pipeline': 'output',
			RTT: 'output',
			'FXAA [ RTT ]': 'output',
			'': 'other',
			'a scene': 'other'
		};
		for (const [name, pass] of Object.entries(cases)) expect(passOf(name), name).toBe(pass);
	});

	it('averages over the frames timed, whole and by pass', () => {
		const names = new Map([
			['r:1:f7', 'scene'],
			['r:2:f7', 'Bloom [ High Pass ]'],
			['r:3:f7', 'Bloom [ Composite ]'],
			['r:1:f8', 'scene'],
			['r:2:f8', 'Bloom [ High Pass ]']
		]);
		const durations: [string, number][] = [
			['r:1:f7', 2],
			['r:2:f7', 0.5],
			['r:3:f7', 0.5],
			['r:1:f8', 4],
			['r:2:f8', 1],
			['r:9:f8', 2]
		];
		expect(byPass(durations, names)).toEqual({
			total: 5,
			passes: { scene: 3, bloom: 1, other: 1 }
		});
		expect(byPass([], names)).toBeNull();
	});
});
