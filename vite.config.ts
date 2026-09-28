import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import type { BrowserCommand } from 'vitest/node';
import type { BrowserContext } from 'playwright';
import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';

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
		provider: playwright({ launchOptions: { args } }),
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
				comparatorOptions: { threshold: 0.1, allowedMismatchedPixelRatio: 0.005 }
			}
		}
	};
}

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
	build: {
		rolldownOptions: {
			output: {
				// three.js always gets its own chunk, so a module shared by the eager
				// pages and the lazy renderer never drags it into a page's static
				// imports (see scripts/check-bundle.mjs). The Inspector (?perf&inspector)
				// stays out of it, a chunk of its own fetched only when asked for.
				codeSplitting: {
					groups: [
						{
							name: 'three',
							test: /[\\/]node_modules[\\/]three[\\/](?!examples[\\/]jsm[\\/]inspector[\\/])/
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
					provide: { backend: 'webgl' as const },
					attachmentsDir: '.vitest-attachments',
					include: ['src/**/*.svelte.{test,spec}.{js,ts}'],
					exclude: ['src/lib/server/**']
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
								provide: { backend: 'webgpu' as const },
								// One file at a time: the recovery test crashes the GPU process, which would
								// take WebGPU away from files running beside it.
								fileParallelism: false,
								attachmentsDir: '.vitest-attachments',
								include: [
									'src/lib/tabletop/golden.svelte.spec.ts',
									'src/lib/tabletop/renderer.svelte.spec.ts',
									'src/lib/tabletop/recovery.svelte.spec.ts',
									'src/lib/tabletop/post.svelte.spec.ts',
									'src/lib/tabletop/unexplored-black.svelte.spec.ts'
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
					include: ['src/**/*.{test,spec}.{js,ts}', 'server/**/*.{test,spec}.ts'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	}
});
