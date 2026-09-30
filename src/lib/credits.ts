// What ships inside thirdfold besides its own work, for /credits (#189). The
// npm entries are checked against their package.json licences in
// credits.spec.ts; the vendored and build-time ones are listed by hand.

export interface Shipped {
	name: string;
	/** An SPDX id. */
	license: string;
	url: string;
	/** The npm package whose package.json states the licence (checked by the test). */
	pkg?: string;
	kind: 'code' | 'font' | 'tool';
	/** What it does here, when the name doesn't say. */
	note?: string;
}

export const SHIPPED: readonly Shipped[] = [
	{ name: 'three.js', pkg: 'three', license: 'MIT', url: 'https://threejs.org', kind: 'code' },
	{ name: 'Svelte', pkg: 'svelte', license: 'MIT', url: 'https://svelte.dev', kind: 'code' },
	{
		name: 'SvelteKit',
		pkg: '@sveltejs/kit',
		license: 'MIT',
		url: 'https://svelte.dev/docs/kit',
		kind: 'code'
	},
	{
		name: 'Supabase JS',
		pkg: '@supabase/supabase-js',
		license: 'MIT',
		url: 'https://github.com/supabase/supabase-js',
		kind: 'code'
	},
	{
		name: 'Capacitor',
		pkg: '@capacitor/core',
		license: 'MIT',
		url: 'https://capacitorjs.com',
		kind: 'code'
	},
	{
		name: 'Basis Universal transcoder',
		license: 'Apache-2.0',
		url: 'https://github.com/BinomialLLC/basis_universal',
		kind: 'code',
		note: 'vendored by three.js; decodes KTX2 textures'
	},
	{
		name: 'meshoptimizer decoder',
		license: 'MIT',
		url: 'https://github.com/zeux/meshoptimizer',
		kind: 'code',
		note: 'vendored by three.js; decodes compressed geometry'
	},
	{
		name: 'ktx-parse',
		license: 'MIT',
		url: 'https://github.com/donmccurdy/KTX-Parse',
		kind: 'code',
		note: 'vendored by three.js; reads KTX2 files'
	},
	{
		name: 'Alegreya',
		pkg: '@fontsource/alegreya',
		license: 'OFL-1.1',
		url: 'https://github.com/huertatipografica/Alegreya',
		kind: 'font',
		note: 'by Huerta Tipográfica'
	},
	{
		name: 'Alegreya Sans',
		pkg: '@fontsource/alegreya-sans',
		license: 'OFL-1.1',
		url: 'https://github.com/huertatipografica/Alegreya-Sans',
		kind: 'font',
		note: 'by Huerta Tipográfica'
	},
	{
		name: 'ktx2-encoder',
		license: 'MIT',
		url: 'https://github.com/gz65555/ktx2-encoder',
		kind: 'tool',
		note: 'builds KTX2 textures, with Basis Universal (Apache-2.0)'
	}
];

/** The SRD 5.2.1 attribution (CC-BY-4.0), which the rules track supplies (#88). */
export const SRD_ATTRIBUTION: string | null = null;
