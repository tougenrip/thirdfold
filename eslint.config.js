import prettier from 'eslint-config-prettier';
import path from 'node:path';
import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import { defineConfig, includeIgnoreFile } from 'eslint/config';
import globals from 'globals';
import ts from 'typescript-eslint';

const gitignorePath = path.resolve(import.meta.dirname, '.gitignore');

export default defineConfig(
	includeIgnoreFile(gitignorePath),
	// Built assets: three's KTX2 transcoder is copied in as it ships (#188).
	{ ignores: ['static/assets/'] },
	js.configs.recommended,
	ts.configs.recommended,
	svelte.configs.recommended,
	prettier,
	svelte.configs.prettier,
	{
		languageOptions: { globals: { ...globals.browser, ...globals.node } },
		rules: {
			// typescript-eslint strongly recommend that you do not use the no-undef lint rule on TypeScript projects.
			// see: https://typescript-eslint.io/troubleshooting/faqs/eslint/#i-get-errors-from-the-no-undef-rule-about-global-variables-not-being-defined-even-though-there-are-no-typescript-errors
			'no-undef': 'off'
		}
	},
	{
		files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
		languageOptions: {
			parserOptions: {
				projectService: true,
				extraFileExtensions: ['.svelte'],
				parser: ts.parser
			}
		}
	},
	{
		// The renderer's shaders are TSL graphs from the material module's closed set of kinds
		// (#169): no GLSL or WGSL strings, and no patching a built-in material's shader.
		files: ['src/lib/tabletop/**'],
		rules: {
			'no-restricted-properties': [
				'error',
				{ property: 'onBeforeCompile', message: 'Use a shader kind (tabletop/materials).' },
				{ property: 'glslFn', message: 'No GLSL: write the graph in TSL.' },
				{ property: 'wgslFn', message: 'No WGSL: write the graph in TSL.' }
			],
			// Named imports only: `no-restricted-imports` with `importNames` would also refuse every
			// `import * as THREE from 'three/webgpu'`; members of those are covered above.
			'no-restricted-syntax': [
				'error',
				{
					selector: 'ImportSpecifier[imported.name=/^(glsl|wgsl)Fn$/]',
					message: 'No GLSL or WGSL: write the graph in TSL.'
				}
			]
		}
	},
	{
		// Override or add rule settings here, such as:
		// 'svelte/button-has-type': 'error'
		rules: {}
	}
);
