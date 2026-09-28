// The browser the perf scripts measure in: which GPU draws (PERF_GPU) and
// which of WebGPURenderer's backends (PERF_BACKEND). Shared by perf-client.mjs
// and perf-gpu.mjs.
//
// PERF_GPU: vulkan (default: the real GPU; the reference is an RTX 4060
// Laptop), swiftshader (software, the same everywhere, but its shader
// compiles are slow) or egl (ANGLE over the system's GL).
// PERF_BACKEND: webgl (default; WebGPURenderer's WebGL2 backend, forced with
// ?backend=webgl) or webgpu (a real GPU only: Chromium's SwiftShader WebGPU
// drops its instance once the table draws, so software runs are WebGL2).

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const GL = {
	swiftshader: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
	vulkan: ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist'],
	egl: ['--use-angle=gl-egl', '--ignore-gpu-blocklist']
};
const WEBGPU = ['--enable-unsafe-webgpu'];

export const GPU = process.env.PERF_GPU ?? 'vulkan';
export const BACKEND = process.env.PERF_BACKEND ?? 'webgl';
if (!GL[GPU]) throw new Error(`PERF_GPU must be one of ${Object.keys(GL).join(', ')}`);
if (BACKEND !== 'webgl' && BACKEND !== 'webgpu')
	throw new Error('PERF_BACKEND must be webgl or webgpu');
if (BACKEND === 'webgpu' && GPU === 'swiftshader')
	throw new Error('Measure WebGPU on a real GPU (PERF_GPU=vulkan): SwiftShader runs are WebGL2.');

/**
 * The query a measured table page opens with: the perf overlay, on the chosen backend, plus
 * PERF_EXTRA (e.g. `tonemap=agx`) for A/B runs.
 */
export const PERF_QUERY =
	(BACKEND === 'webgl' ? '?perf&backend=webgl' : '?perf') +
	(process.env.PERF_EXTRA ? `&${process.env.PERF_EXTRA}` : '');

export function launchBrowser() {
	return chromium.launch({
		executablePath: process.env.CHROMIUM_PATH || undefined,
		args: [...GL[GPU], ...(BACKEND === 'webgpu' ? WEBGPU : [])]
	});
}

/** Fails a run that measured another backend than asked (WebGPU missing falls back to WebGL2). */
export function checkBackend(stats) {
	const want = BACKEND === 'webgl' ? 'webgl2' : 'webgpu';
	if (stats.backend !== want)
		throw new Error(`Asked for ${want} but the page draws with ${stats.backend}.`);
}
