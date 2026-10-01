import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import type { BrowserCommand } from 'vitest/node';
import type { BrowserContext } from 'playwright';
import { ssimComparator } from './tests/visual/ssim.ts';
import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

/**
 * The asset manifest's content hash, in its URL (assets/load.ts): the manifest is the one asset file
 * at a fixed name, so without it a browser or host cache could hand a new client an old manifest.
 */
// Tests draw only the bases a checkout carries, whatever a local .env points the asset host at
// (Vite keeps a variable already in the environment over the .env files).
if (process.env.VITEST) process.env.VITE_ASSET_BASE_URL = '';

const ASSET_MANIFEST = createHash('sha256')
	.update(readFileSync('static/assets/manifest.json'))
	.digest('hex')
	.slice(0, 12);

/**
 * Crashes the browser's GPU process: every page loses its WebGL context or WebGPU device, as after a
 * driver reset. For the recovery tests (#150).
 */
const crashGpu: BrowserCommand<[]> = async (ctx) => {
	const { context } = ctx as unknown as { context: BrowserContext };
	const cdp = await context.browser()!.newBrowserCDPSession();
	await cdp.send('Browser.crashGpuProcess');
};

/** The browser a client test project draws in: Chromium at DPR 1, 800x500, no tester UI. */
function browser(args: string[], headless: boolean) {
	return {
		enabled: true,
		// Playwright's 30 s default is short for a high-tier capture on CI's small runners since the
		// textured assets (M65); the tests' own timeouts still bound every action.
		provider: playwright({ launchOptions: { args }, actionTimeout: 90_000 }),
		viewport: { width: 800, height: 500 },
		// No tester UI around the test frame: it would scale the frame, and every screenshot, down.
		ui: false,
		// A failed test's screenshot can time out on a slow runner, and its console.error then fails
		// the tests after it; the golden images compare their own screenshots.
		screenshotFailures: false,
		instances: [{ browser: 'chromium' as const, headless }],
		commands: { crashGpu },
		expect: {
			toMatchScreenshot: {
				comparatorName: 'pixelmatch' as const,
				// No limit of its own: @vitest/browser 4.1.11 races the capture against a timer it never
				// clears, which kept the process alive for up to this long after every golden run
				// ("something prevents the main process from exiting"). With 0 there is no timer, and
				// the golden tests' own 60 s timeout bounds a capture (CI's small runners take seconds).
				timeout: 0,
				comparatorOptions: { threshold: 0.1, allowedMismatchedPixelRatio: 0.005 },
				// SSIM for captures with TRAA, GTAO or depth of field (#168): tests/visual/ssim.ts.
				comparators: { ssim: ssimComparator }
			}
		}
	};
}

/** `THIRDFOLD_GOLDENS=slim|full` runs the golden images (package.json's test:golden scripts). */
const GOLDENS = (['slim', 'full'] as const).find((g) => g === process.env.THIRDFOLD_GOLDENS);
const GOLDEN_SPEC = 'src/lib/tabletop/golden.svelte.spec.ts';
/** `THIRDFOLD_UNEXPLORED=full` runs every unexplored-black case (by hand); CI takes the slim set. */
const UNEXPLORED = process.env.THIRDFOLD_UNEXPLORED === 'full' ? ('full' as const) : undefined;
/**
 * The renderer's pixel tests, minutes each on SwiftShader: not in `npm test` (so CI's verify job
 * stays within minutes), but in `npm run test:render` and in .github/workflows/rendering.yml, on
 * pull requests that touch rendering (`THIRDFOLD_RENDER=1`).
 */
const RENDER = process.env.THIRDFOLD_RENDER === '1';
const RENDER_SPECS = [
	'renderer',
	'scheduling',
	'stability',
	'fixtures',
	'recovery',
	'post',
	'effects',
	'grade',
	'overlay',
	'focus',
	'shot-focus',
	'unexplored-black',
	'materials',
	'cell-maps',
	'program-count',
	'mapping',
	'kind-layers',
	'fog-soft',
	'lobby',
	'sky',
	'sky-light',
	'atmosphere',
	'flash',
	'exposure',
	'grid-lights',
	'translucency',
	'probe-grid',
	'hero-shadows'
].map((name) => `src/lib/tabletop/${name}.svelte.spec.ts`);

export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter: adapter({ fallback: 'index.html' }) // SPA mode for native shells
		})
	],
	define: { __ASSET_MANIFEST__: JSON.stringify(ASSET_MANIFEST) },
	build: {
		rolldownOptions: {
			output: {
				// three.js always gets its own chunk, so a module shared by the eager
				// pages and the lazy renderer never drags it into a page's static
				// imports (see scripts/check-bundle.mjs). The Inspector (?perf&inspector),
				// the decoders cooked assets need (KTX2, meshopt; tabletop/decoders.ts) and
				// the probe grid (tabletop/probe-grid.ts, #235) stay out of it, chunks of
				// their own fetched only when asked for.
				codeSplitting: {
					groups: [
						{
							name: 'three',
							test: /[\\/]node_modules[\\/]three[\\/](?!examples[\\/]jsm[\\/](inspector[\\/]|loaders[\\/]KTX2Loader|libs[\\/](ktx-parse|zstddec|meshopt_decoder)|(tsl[\\/])?lighting[\\/]LightProbeGrid))/
						}
					]
				}
			}
		}
	},
	server: { port: 1420, strictPort: true, host: '0.0.0.0' },
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'client',
					// Renderer tests and golden images draw with SwiftShader at DPR 1 on
					// an 800x500 viewport, so pixels never depend on the machine's GPU.
					browser: browser(['--use-angle=swiftshader', '--enable-unsafe-swiftshader'], true),
					provide: {
						backend: 'webgl' as const,
						goldens: GOLDENS ?? 'slim',
						shard: process.env.THIRDFOLD_SHARD ?? '1/1',
						unexplored: UNEXPLORED ?? ('slim' as const)
					},
					attachmentsDir: '.vitest-attachments',
					include: ['src/**/*.svelte.{test,spec}.{js,ts}'],
					// Golden images run only on their own (`npm run test:golden`, CI's slim set on PRs that
					// touch rendering; `test:golden:full` by hand), never with the rest of the tests.
					exclude: [
						'src/lib/server/**',
						...(GOLDENS ? [] : [GOLDEN_SPEC]),
						...(RENDER || GOLDENS ? [] : RENDER_SPECS)
					]
				}
			},
			// The same golden images and renderer smoke tests through the WebGPU backend, on the real
			// GPU (the RTX 4060 Laptop, the reference machine): `npm run test:webgpu`, locally only
			// (#151). Chrome's WebGPU picks its own SwiftShader over Mesa's lavapipe, and SwiftShader's
			// WebGPU is too slow and unreliable to test on; the references belong to that GPU and driver.
			...(process.env.THIRDFOLD_WEBGPU === '1'
				? [
						{
							extends: './vite.config.ts',
							test: {
								name: 'client-webgpu',
								browser: browser(
									[
										'--use-angle=vulkan',
										'--enable-features=Vulkan',
										'--ignore-gpu-blocklist',
										'--enable-unsafe-webgpu'
									],
									true
								),
								provide: {
									backend: 'webgpu' as const,
									goldens: GOLDENS ?? 'full',
									shard: '1/1',
									unexplored: UNEXPLORED ?? ('slim' as const)
								},
								// One file at a time: the recovery test crashes the GPU process, which would
								// take WebGPU away from files running beside it.
								fileParallelism: false,
								attachmentsDir: '.vitest-attachments',
								include: [
									...(GOLDENS ? [GOLDEN_SPEC] : []),
									'src/lib/tabletop/renderer.svelte.spec.ts',
									'src/lib/tabletop/scheduling.svelte.spec.ts',
									'src/lib/tabletop/fixtures.svelte.spec.ts',
									'src/lib/tabletop/stability.svelte.spec.ts',
									'src/lib/tabletop/recovery.svelte.spec.ts',
									'src/lib/tabletop/post.svelte.spec.ts',
									'src/lib/tabletop/grade.svelte.spec.ts',
									'src/lib/tabletop/unexplored-black.svelte.spec.ts',
									'src/lib/tabletop/materials.svelte.spec.ts',
									'src/lib/tabletop/cell-maps.svelte.spec.ts',
									'src/lib/tabletop/sky-light.svelte.spec.ts',
									'src/lib/tabletop/program-count.svelte.spec.ts',
									'src/lib/tabletop/mapping.svelte.spec.ts',
									'src/lib/tabletop/paint.svelte.spec.ts',
									'src/lib/tabletop/kind-layers.svelte.spec.ts',
									'src/lib/tabletop/lobby.svelte.spec.ts',
									'src/lib/tabletop/grid-lights.svelte.spec.ts',
									'src/lib/tabletop/probe-grid.svelte.spec.ts'
								]
							}
						}
					]
				: []),

			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: [
						'src/**/*.{test,spec}.{js,ts}',
						'server/**/*.{test,spec}.ts',
						'tests/**/*.spec.ts'
					],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	}
});
