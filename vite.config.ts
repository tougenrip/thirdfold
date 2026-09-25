import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';

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
				// imports (see scripts/check-bundle.mjs).
				codeSplitting: {
					groups: [{ name: 'three', test: /[\\/]node_modules[\\/]three[\\/]/ }]
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
					browser: {
						enabled: true,
						provider: playwright({
							launchOptions: {
								args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
							}
						}),
						viewport: { width: 800, height: 500 },
						// No tester UI around the test frame: it would scale the frame, and every screenshot, down.
						ui: false,
						instances: [{ browser: 'chromium', headless: true }],
						expect: {
							toMatchScreenshot: {
								comparatorName: 'pixelmatch',
								comparatorOptions: { threshold: 0.1, allowedMismatchedPixelRatio: 0.005 }
							}
						}
					},
					attachmentsDir: '.vitest-attachments',
					include: ['src/**/*.svelte.{test,spec}.{js,ts}'],
					exclude: ['src/lib/server/**']
				}
			},

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
