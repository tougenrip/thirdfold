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
	// from it), 98,180 B measured. → 98.4: the shared chunk after M68's close (the pool's removal
	// and the hero slots' assignment moving out of light-model.ts) measures just over 98.3 kB.
	// → 100.0: the manifest's kits and their parser with the roles' envelopes (kit.ts, #250), 99.9 kB
	// measured. → 100.3: the shared chunk after roof fades (#259: Tabletop.setOwnTokens), just over
	// 100.0 kB measured.
	// → 100.6: EnemyDef.scale and the builder's size field (#270), the manifest's poses (#273).
	'/builder': { total: 100_600, own: 52_000 },
	// 54.0 → 54.8: the same (#250), 54.7 kB measured.
	// → 55.0: the manifest's `miniBase` (#265); 54.8 kB measured.
	'/credits': { total: 55_000, own: 3_000 },
	// Dev only (#194): in production the page is a 404 and the turntable is not in the build.
	// 50.0 → 51.1: the sky presets' parser in the manifest's (#213), 50,980 B measured.
	// → 51.2: the same shared code (#215), 51,128 B measured.
	// → 52.8: the manifest's kits (#250), 52.7 kB measured.
	// → 53.0: a figure's poses in the manifest (#273, `readPoses`); 52,925 B measured.
	'/dev/assets': { total: 53_000, own: 500 },
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
	// scheduling by view); 373.2 kB measured. → 374.6: light fixtures by kind, carried flames and
	// props' flames (#232); 374.5 kB measured. → 374.9: translucency (#237: the lighting model's
	// term, translucent models' own materials). → bounce and cavity (#234: the fields, their packing
	// and the node's gated lookup), and the cell maps kept at the largest grid's size (#380); set to
	// the merged build's measured size (the owner raised M68's cap to about 382 kB). → strips and
	// panels (#236: their samples, the no-core flag in the node, fixtures by facing), and the probe
	// grid's side (#235: its layout and bake policy, the setters it watches, the scheduler's
	// background work, the bake flag); the grid itself is a lazy chunk (`probes` below); set to the
	// merged build's measured size.
	// → hero shadow slots (#230: the pool, its lights' node and atlas shadow, the slot
	// assignment); set to the merged build's measured size. → 382.9: M67's pool of 8 point lights
	// and the `manylights` layer removed at M68's close; 382.8 kB measured.
	// → the tier refined only from steady frames (models settled, no warm-up gallery): 383.0.
	// → M69 raises it per PR to the measured size, capped at about 393 kB (the owner's decision):
	// walls from the world shape's wall spans (#239), 383.2; cells picked by the DDA, things on the
	// pick layer (#246), 383.7; dice and pooled previews on the ground (#247), 384.7 (384,615 B measured);
	// the ground in chunks (#240: the dual-grid emitter, the world layer and the saddles' canStep),
	// 390.0 (389.9 kB measured; the owner's M69 cap is about 393). → 386.1: the world's builders
	// moved to their own chunk (`world` below, the owner's decision); 386,062 B measured.
	// → 386.3: what lies beyond the grid (#244: the landscape layer, the fog's depth term, its
	// builders in `world`); 386,226 B measured. → the cliffs' rock kind (#241: biplanar on low,
	// `worldModify` reading the cell behind a face, the layer's faces by style); set to the merged
	// build's measured size.
	// → floors blended per pixel (#242: the splat in the terrain kind's graph); set to the merged
	// build's measured size.
	// → the shader grid (#245: its node, the twins, the modes and the highlight's patterns); set
	// to the merged build's measured size.
	// → 389.8: the void's chasms (#243: the void's floor in the world layer, its mist and clock,
	// the surface kind's flow, picks into the void); 389,798 B measured.

	// → drop-in (#249: the drops' clock, which props drop, the vertex node and its shadow rest);
	// set to the merged build's measured size.
	// → 390.0: M69's close deleted the old raised-cell boxes, the play plane, the `LineSegments` grid,
	// the highlight plane and the `terrain` layer; 389,901 B measured. → 390.2: the M69 load fix
	// (warm-ups compile in parallel chunks in each pass's context, the floors' box shared);
	// 390,193 B measured. → 396.1: kit walls (#252: three's BatchedMesh, about 4.2 kB of it, the
	// walls' chunked batches, picking proxy and highlight, the surface kind's `batched` variant).
	// → kit floor tiles (#254: the tile layer, its ring and the sink and bed in the prop and terrain
	// graphs) → stairs (#255: walls and the environment's ground read, the stairs' trim and the
	// kit's stair pieces baked into the faces); set to the merged build's measured size (the owner
	// raised M70's cap to about 405 kB). → door leaves (#253: one batch, door-leaves.ts and batch.ts)
	// → roofs (#257: the roof layer, the surface kind's `roof` variant and the sky terms picked per
	// material); set to the merged build's measured size. → roof fades (#259: the fade map and the
	// roof variant's dithered mask, the layer's fades on the wall clock, after #258); 401,941 B
	// measured.
	// → the GridLights' cell lookup at the centroid (two varyings, grid-light-node.ts); 403.0 kB.
	// → 403.7: kit textures (M70: kit pieces on their trim sheet by UV, the surface kind's `sheet`
	// variant, a batch per sheet, `sheetOf`, sheeted floor tiles); 403.7 kB measured after the merge. → 404.0: the
	// perf tags (#264, `tagged` in perf.ts); 403.8 kB measured. → 399.6: kit pieces as a pool of
	// InstancedMeshes on both backends (M70 after #264: piece-pool.ts, the surface kind's `piece`
	// variant; three's BatchedMesh and batch.ts gone, about 4.3 kB); 399.5 kB measured.
	// → 399.8: warm-ups at the draw depth (warmup.ts, DrawDepths and unlit); 399.7 kB measured.
	// → 400.0: still texture reads leave WebGL2's update lists (materials/still-textures.ts, the
	// orbit's main thread 18.6 → 10 ms); 399,836 B measured. → 402.0: token bases (#265: the base
	// kind's graph, base-layer.ts, the lathe); 401.7 kB measured. → 403.0: names on demand (#268:
	// label-layer.ts, the atlas and two instanced sprites, replacing the per-token label sprites);
	// 402.9 kB measured after the merge (M71's cap is about 410 kB). → dice as PBR sets (#275: one InstancedMesh per
	// kind, the dice material, the atlas's UVs; decal canvases and pips gone); 403.1 kB measured after the merge.
	// → the miniature kind's wash, drybrush, varnish and rim (#267, materials/mini.ts); 403.6 kB
	// measured.
	// → 405.0: token figures as instanced batches (#266, figures.ts: the swap-remove slots, the merged
	// plain miniature); 404.7 kB measured. → 405.2: large creatures' bases (#270: a base mesh per
	// size, the shrink rule, base picking by its centre disc); 405.1 kB measured. → static poses (#273: `poseOf`, the
	// pose in the figure batches and the fall it stands in for); 405.5 kB measured after the merge.
	// → 406.1: contact shadows (#271, contact.ts and the instanced decal's graph, materials/contact.ts);
	// MEASURED kB measured.
	renderer: { total: 406_100 },
	decoders: { total: 40_000 },
	// The probe grid (#235: three's LightProbeGrid, its bake and our node), fetched on high and
	// ultra only with its layer on; 4.5 kB measured.
	probes: { total: 5_000 },
	// The world's builders (M69: world/build.ts, the shape, dual cases, regions, the ground's
	// emitter and the builders to come), fetched with the renderer and awaited by the table;
	// 5,166 B measured. → 7.8: the backdrop beyond the grid (#244: the skirt, the silhouettes and
	// their recipes); 7,762 B measured. → the cliffs and risers (#241, world/cliffs.ts); set to the
	// merged build's measured size. → 10.4: the void's chasms (#243, world/chasm.ts and the
	// ground's void floor); 10,369 B measured. → 12.4: wall autotiling (#251, world/autotile.ts);
	// 12,355 B measured. → 13.6: kit walls' instances and built-in pieces (#252, world/wall-batch.ts).
	// → kit floor tiles (#254, world/floor-tiles.ts) → stairs (#255, world/stairs.ts and the stair
	// faces in cliffs.ts); set to the merged build's measured size. → 19.5: bridges and balustrades
	// (#256, world/bridges.ts, world/bridge-mesh.ts and the bridge runs in regions.ts) → window and
	// door frames, arcades and the built-in leaf (#253) → roofs (#257, world/roofs.ts); set to the
	// merged build's measured size. → 23.0: hips, wings, caps, chimneys and dormers (#258,
	// world/roof-mesh.ts); 22,953 B measured. → 23.1: roof fades' rule (#259, world/roof-fade.ts);
	// 23,016 B measured. → glazed windows (#260, world/glazing.ts); 23,597 B measured. → 23.7:
	// kit pieces' UVs (M70, `pieceOf`); 23,650 B measured.
	world: { total: 23_700 }
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
// The probe grid (tabletop/probe-grid.ts) likewise: on high and ultra with its layer on.
const probesKey = Object.keys(manifest).find((k) => k.endsWith('src/lib/tabletop/probe-grid.ts'));
if (!probesKey) failures.push('the probe grid is not a chunk of its own');
else if (rendererFiles.has(manifest[probesKey].file))
	failures.push('the renderer statically imports the probe grid');
else {
	const own = [...closure(probesKey)].filter((f) => !rendererFiles.has(f) && !roomFiles.has(f));
	const { gz } = total(own);
	log('probes (added)'.padEnd(18), kb(gz).padStart(21), kb(BUDGETS.probes.total).padStart(10));
	if (gz > BUDGETS.probes.total) failures.push(`the probe grid is ${kb(gz)} gz, over budget`);
}
// The world's builders (tabletop/world/build.ts) likewise: with every table, never in its closure.
const worldKey = Object.keys(manifest).find((k) => k.endsWith('src/lib/tabletop/world/build.ts'));
if (!worldKey) failures.push("the world's builders are not a chunk of their own");
else if (rendererFiles.has(manifest[worldKey].file))
	failures.push("the renderer statically imports the world's builders");
else {
	const own = [...closure(worldKey)].filter((f) => !rendererFiles.has(f) && !roomFiles.has(f));
	const { gz } = total(own);
	log('world (added)'.padEnd(18), kb(gz).padStart(21), kb(BUDGETS.world.total).padStart(10));
	if (gz > BUDGETS.world.total) failures.push(`the world's builders are ${kb(gz)} gz, over budget`);
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
