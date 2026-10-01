// Bundle gate, run after `npm run build`: each route page's static import
// closure (gzipped) must stay within its budget and never contain three.js,
// and what the lazily loaded renderer adds when a table loads must stay within
// its own budget. 'own' is what a page adds beyond the app shell (the entries
// and the root layout), which every page shares. Reads the Vite manifest; see
// docs/PERFORMANCE.md.
//   node scripts/check-bundle.mjs [--json]   (--json prints the sizes as JSON instead of a table)

import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

/**
 * Budgets in gzipped bytes: `total` for a page's whole static closure, `own`
 * for what it adds beyond the shell. Set at the measured size plus about 10%
 * in milestone 61; a PR that raises one says why.
 */
const BUDGETS = {
	'/': { total: 64_000, own: 19_000 },
	// 97.0 → 97.4: the manifest's sky presets and their closed parser (sky-parse.ts, #213), 97,327 B
	// measured.
	// 97.4 → 97.5: the sky's resolver and the canonical hours, now used by the renderer, stay in the
	// shared chunk with the manifest's parser (#215), 97,479 B measured.
	// 97.5 → 98.2: GridLights' sources and sight cache (#228) keep the shared chunk of the grid's,
	// objects' and visibility's code larger (the renderer now uses `SightCache` and `asObstacles`
	// from it), 98,180 B measured.
	'/builder': { total: 98_300, own: 52_000 },
	'/credits': { total: 54_000, own: 3_000 },
	// Dev only (#194): in production the page is a 404 and the turntable is not in the build.
	// 50.0 → 51.1: the sky presets' parser in the manifest's (#213), 50,980 B measured.
	// → 51.2: the same shared code (#215), 51,128 B measured.
	'/dev/assets': { total: 51_200, own: 500 },
	'/library': { total: 66_000, own: 21_000 },
	// 121.0 → 121.7: the blocked-storage guard, the manifest's versioned URL and the table's loading
	// cover (TableLoading.svelte), 121,687 B measured.
	'/room/[id]': { total: 121_700, own: 76_000 },
	// 360.0 → 360.1: light looks (intensity, still flames, no fixture for a glow), prop paint and
	// token lift and scale (#201, #202), 360,059 B measured.
	// 360.1 → 360.4: the lighting presets blended by the hour (time-blend.ts, #208), 360,326 B
	// measured. → 361.1: the GM's handles on fixture-less lights (#209; as a lazy chunk they split
	// the shared code into more chunks and cost twice as much), +538 B measured; both together 361.0 kB.
	// → 361.4: sky visibility in the cell maps and worldModify (#219), 361.3 kB measured.
	// → the atmosphere (#215, #217, #218: the fog and environment nodes, the key light's tween
	// and shadow rule, the curve), less the presets, their blend, the mist and the lamp; three's
	// fog and PMREM code was already in the chunk. Set to the merged build's measured size.
	// → 364.5: the flash's envelope and policy wired to exposure, bloom and the hemisphere (#222,
	// #223). → the sky layer (#214: the dome, moon, stars and clouds, the star field) and its
	// capture throttle (#216), wired into the table and the lobby (plan D1: not lazy, three's sky
	// code was already here); set to the merged build's measured size. → 368.1: the ground to the
	// horizon (#220: the ring's mesh and tier, the camera's clearance, extents per table), less
	// the slab; 368.1 kB measured. → 368.4: the low tier's small cube and the dome's haze at the
	// horizon (#225); 368.3 kB measured. → 368.9: exposure from the focus cell (#233). → 369.5:
	// the sun and moon shadow fitted to the grid (#229). → the map's fog rectangle, the ring's land
	// look and the vignette by distance (#377); set to the merged build's measured size.
	// → 373.0: GridLights (#228: the node, its CPU side and the client's sight cache, the lit kinds'
	// lighting model); 372.9 kB measured (the milestone's cap is
	// about 378 kB). → 373.3: flicker in the shader (#231: the profiles, their TSL mirror and the
	// scheduling by view); 373.2 kB measured.
	renderer: { total: 373_300 },
	decoders: { total: 40_000 }
};
/** Only KTX2Loader and the Basis transcoder carry these (#188): never in the renderer's closure. */
const DECODER_MARKERS = ['Multiple active KTX2 loaders', 'basis_transcoder'];
/** Only the asset turntable (tabletop/turntable.ts, #194) has this: dev builds only. */
const TURNTABLE_MARKER = 'thirdfold-turntable';
/** Only classic WebGLRenderer (build/three.module.js) has this: the renderer is WebGPURenderer now. */
const CLASSIC_MARKER = 'THREE.WebGLRenderer: Error creating WebGL context';
/** Property names three.js keeps through minification. */
const THREE_MARKERS = ['isVector3', 'isObject3D', 'isBufferGeometry'];

const OUT = '.svelte-kit/output/client';
const manifest = JSON.parse(readFileSync(`${OUT}/.vite/manifest.json`, 'utf8'));
const app = readFileSync('.svelte-kit/generated/client-optimized/app.js', 'utf8');
const dictionary = JSON.parse(
	app.match(/export const dictionary = (\{[\s\S]*?\});/)[1].replace(/,\s*}/, '}')
);

const sizes = new Map();
function measure(file) {
	if (!sizes.has(file)) {
		const code = readFileSync(`${OUT}/${file}`);
		const text = code.toString('utf8');
		sizes.set(file, {
			raw: code.length,
			gz: gzipSync(code).length,
			three: THREE_MARKERS.some((m) => text.includes(m)),
			classic: text.includes(CLASSIC_MARKER)
		});
	}
	return sizes.get(file);
}

/** Every file a manifest entry pulls in statically, itself included. */
function closure(key, seen = new Set()) {
	const entry = manifest[key];
	if (!entry || seen.has(entry.file)) return seen;
	seen.add(entry.file);
	for (const dep of entry.imports ?? []) closure(dep, seen);
	return seen;
}

function total(files) {
	let raw = 0;
	let gz = 0;
	let three = false;
	let classic = false;
	for (const f of files) {
		const s = measure(f);
		raw += s.raw;
		gz += s.gz;
		three ||= s.three;
		classic ||= s.classic;
	}
	return { raw, gz, three, classic };
}

const nodeKey = (n) => `.svelte-kit/generated/client-optimized/nodes/${n}.js`;
const rendererKey = Object.keys(manifest).find((k) => k.endsWith('src/lib/tabletop/renderer.ts'));
if (!rendererKey) throw new Error('No renderer entry in the manifest: was it made eager?');

const shell = new Set();
for (const [key, entry] of Object.entries(manifest)) {
	if (entry.isEntry && !/nodes\/[1-9]\d*\.js$/.test(key)) closure(key, shell);
}

const rows = [];
let roomFiles = new Set();
for (const [route, [node]] of Object.entries(dictionary)) {
	const files = closure(nodeKey(node), new Set(shell));
	if (route === '/room/[id]') roomFiles = files;
	const own = total([...files].filter((f) => !shell.has(f))).gz;
	rows.push({ name: route, ...total(files), own, budget: BUDGETS[route] });
}
const added = [...closure(rendererKey)].filter((f) => !roomFiles.has(f));
rows.push({ name: 'renderer (added)', ...total(added), budget: BUDGETS.renderer, lazy: true });

const kb = (n) => `${(n / 1000).toFixed(1)} kB`;
const failures = [];
const asJson = process.argv.includes('--json');
const log = asJson ? () => {} : console.log;
const cols = ['closure', 'raw', 'gz', 'budget', 'own gz', 'budget', 'three.js'];
log(cols[0].padEnd(18), ...cols.slice(1).map((c) => c.padStart(10)));
for (const r of rows) {
	const { total: max, own: maxOwn } = r.budget;
	log(
		r.name.padEnd(18),
		kb(r.raw).padStart(10),
		kb(r.gz).padStart(10),
		kb(max).padStart(10),
		(r.own === undefined ? '-' : kb(r.own)).padStart(10),
		(maxOwn === undefined ? '-' : kb(maxOwn)).padStart(10),
		(r.three ? 'yes' : 'no').padStart(10)
	);
	if (r.three && !r.lazy) failures.push(`${r.name} statically imports three.js`);
	if (r.classic) failures.push(`${r.name} bundles the classic WebGLRenderer`);
	if (r.gz > max) failures.push(`${r.name} is ${kb(r.gz)} gz, over ${kb(max)}`);
	if (maxOwn !== undefined && r.own > maxOwn) {
		failures.push(`${r.name} adds ${kb(r.own)} gz to the shell, over ${kb(maxOwn)}`);
	}
}
// The decoders (tabletop/decoders.ts) are a chunk of their own, fetched with the first cooked asset.
const decodersKey = Object.keys(manifest).find((k) => k.endsWith('src/lib/tabletop/decoders.ts'));
const rendererFiles = closure(rendererKey);
if (!decodersKey) failures.push('the decoders are not a chunk of their own');
else {
	const own = [...closure(decodersKey)].filter((f) => !rendererFiles.has(f) && !roomFiles.has(f));
	const { gz } = total(own);
	log('decoders (added)'.padEnd(18), kb(gz).padStart(21), kb(BUDGETS.decoders.total).padStart(10));
	if (gz > BUDGETS.decoders.total) failures.push(`the decoders are ${kb(gz)} gz, over budget`);
}
for (const f of rendererFiles) {
	const text = readFileSync(`${OUT}/${f}`, 'utf8');
	if (DECODER_MARKERS.some((m) => text.includes(m)))
		failures.push(`the renderer statically imports the KTX2 decoders (${f})`);
}
// The asset turntable is dev only: no file of the production build carries it.
for (const f of new Set(Object.values(manifest).map((e) => e.file))) {
	if (readFileSync(`${OUT}/${f}`, 'utf8').includes(TURNTABLE_MARKER))
		failures.push(`the dev-only asset turntable ships in production (${f})`);
}
// The Inspector (?perf&inspector) is its own chunk, fetched only when asked for.
const inspectorKey = Object.keys(manifest).find((k) => k.endsWith('jsm/inspector/Inspector.js'));
if (!inspectorKey) failures.push('three.js Inspector is not a chunk of its own');
else if (closure(rendererKey).has(manifest[inspectorKey].file))
	failures.push('the renderer statically imports the three.js Inspector');
if (asJson) {
	const sizes = Object.fromEntries(
		rows.map((r) => [r.name, { gz: r.gz, own: r.own ?? null, three: r.three }])
	);
	console.log(JSON.stringify({ sizes, failures }));
}
if (failures.length) {
	console.error(`\nBundle check failed:\n- ${failures.join('\n- ')}`);
	process.exit(1);
}
log('\nBundle check passed.');
