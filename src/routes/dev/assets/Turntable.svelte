<script lang="ts">
	// The asset turntable's page (#194, dev only; see +page.svelte): pick a manifest model, see it
	// under the game's light with its facts beside it. `?thumb=<id>&size=256` shows the model alone
	// in the thumbnail pose and sets `window.thirdfoldThumbReady` once drawn (scripts/thumbnails.mjs).
	import { onDestroy, onMount } from 'svelte';
	import { page } from '$app/state';
	import { loadManifest } from '$lib/assets/load';
	import type { Manifest } from '$lib/assets/manifest';
	import type { PerfStats } from '$lib/tabletop/perf';
	import {
		createTurntable,
		LIGHTS,
		modelList,
		type LightPreset,
		type Shown,
		type Turntable
	} from '$lib/tabletop/turntable';

	const thumb = page.url.searchParams.get('thumb');
	const size = Math.min(Math.max(Number(page.url.searchParams.get('size')) || 256, 64), 1024);

	let canvas: HTMLCanvasElement;
	let turntable = $state<Turntable | null>(null);
	let manifest = $state<Manifest | null>(null);
	let query = $state('');
	let id = $state<string | null>(thumb);
	let lod = $state(0);
	let preview = $state(false);
	let light = $state<LightPreset>('day');
	let environment = $state<string | null>(null);
	let spin = $state(false);
	let shown = $state<Shown | null>(null);
	let failed = $state(false);
	let stats = $state<PerfStats | null>(null);

	const entry = $derived(id && manifest ? manifest.models[id] : null);
	const list = $derived(manifest ? modelList(manifest, query) : []);
	const kb = (n: number) => `${(n / 1024).toFixed(1)} kB`;
	const mb = (n: number) => `${(n / 1024 / 1024).toFixed(2)} MB`;

	onMount(async () => {
		manifest = await loadManifest();
		turntable = await createTurntable(canvas, thumb ? { reducedMotion: true, fill: true } : {});
		id ??= modelList(manifest)[0]?.[0] ?? null;
	});
	onDestroy(() => void turntable?.dispose());

	// A model, level or preview picked: show it.
	$effect(() => {
		const t = turntable;
		if (!t || !id) return;
		const [want, level, lighter] = [id, lod, preview];
		failed = false;
		void t.show(want, level, lighter).then((s) => {
			if (want !== id) return;
			shown = s;
			failed = !s;
			if (thumb) void settle();
		});
	});
	$effect(() => turntable?.setLight(light));
	$effect(() => turntable?.setEnvironment(environment));
	$effect(() => turntable?.setSpin(spin));
	const timer = setInterval(() => (stats = turntable?.tabletop.stats() ?? null), 500);
	onDestroy(() => clearInterval(timer));

	/** Ready for a screenshot once warmed up and no frame has been drawn for a while. */
	async function settle(): Promise<void> {
		let [last, still] = [-1, 0];
		while (still < 5) {
			await new Promise((r) => setTimeout(r, 100));
			const s = turntable!.tabletop.stats();
			still = s.frames === last && !s.holding && s.frames > 0 ? still + 1 : 0;
			last = s.frames;
		}
		(window as { thirdfoldThumbReady?: boolean }).thirdfoldThumbReady = true;
	}

	function pick(next: string): void {
		id = next;
		lod = 0;
		preview = false;
	}

	function onKey(e: KeyboardEvent): void {
		if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
		if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
			turntable?.turn((e.key === 'ArrowLeft' ? -1 : 1) * (Math.PI / 12));
			e.preventDefault();
		}
	}
</script>

<svelte:window onkeydown={onKey} />

<div class="page" class:thumb>
	{#if !thumb}
		<aside>
			<h1>Asset turntable</h1>
			<input type="search" placeholder="Search models or kinds" bind:value={query} />
			<ul class="models">
				{#each list as [mid, m] (mid)}
					<li>
						<button class:on={mid === id} onclick={() => pick(mid)}>
							{mid} <span class="muted">{m.kind}</span>
						</button>
					</li>
				{/each}
			</ul>
			<p class="muted">
				Surfaces: {manifest && Object.keys(manifest.surfaces).length
					? Object.keys(manifest.surfaces).join(', ')
					: 'none in the manifest yet (#187)'}
			</p>
		</aside>
	{/if}
	<div class="stage" style:--size={thumb ? `${size}px` : null}>
		<canvas bind:this={canvas}></canvas>
	</div>
	{#if !thumb}
		<aside class="facts">
			<fieldset>
				<legend>Light</legend>
				{#each Object.keys(LIGHTS) as p (p)}
					<label><input type="radio" bind:group={light} value={p} /> {p}</label>
				{/each}
			</fieldset>
			<label>
				Looks like
				<select bind:value={environment}>
					<option value={null}>plain table</option>
					{#each Object.keys(manifest?.environments ?? {}) as e (e)}
						<option value={e}>{e}</option>
					{/each}
				</select>
			</label>
			<label><input type="checkbox" bind:checked={spin} /> Spin (never under reduced motion)</label>
			<p class="muted">Drag to orbit, wheel to zoom, ← → to turn the model.</p>
			{#if entry}
				<h2>{id}</h2>
				<dl>
					<dt>Kind</dt>
					<dd>
						{entry.kind}{entry.setPiece ? ' (set piece)' : ''}{entry.cooked ? ', cooked' : ''}
					</dd>
					<dt>File</dt>
					<dd>{kb(entry.bytes)}, {mb(entry.gpuBytes)} on the GPU (manifest)</dd>
					<dt>Level</dt>
					<dd>
						<select bind:value={lod}>
							{#each shown?.triangles ?? [entry.triangles] as tris, i (i)}
								<option value={i}>LOD{i}: {tris} triangles</option>
							{/each}
						</select>
						<span class="muted">the game draws LOD0 until #274</span>
					</dd>
					<dt>Model</dt>
					<dd>
						<label
							><input type="checkbox" bind:checked={preview} disabled={!entry.preview} />
							preview{entry.preview ? ` (${kb(entry.preview.bytes)})` : ': none'}</label
						>
					</dd>
					<dt>Textures</dt>
					<dd>
						{#each shown?.textures ?? [] as t (t.slot + t.width)}
							<div>{t.slot} {t.width}×{t.height} {t.compressed ? 'KTX2' : 'RGBA'}</div>
						{:else}
							none (vertex colours)
						{/each}
						{#if shown?.texturesBytes}<div class="muted">
								measured +{mb(shown.texturesBytes)}
							</div>{/if}
					</dd>
					<dt>Licence</dt>
					<dd>
						{entry.credit.license}, {entry.credit.author}
						{#if entry.credit.source}<a href={entry.credit.source} rel="external noopener">source</a
							>{/if}
						{#if entry.credit.modified}(modified){/if}
						{#if entry.credit.ai}(AI: {entry.credit.ai.tool}){/if}
					</dd>
				</dl>
				{#if failed}<p class="danger">It failed to load (see the console).</p>{/if}
			{/if}
			{#if stats}
				<p class="muted">
					{stats.backend}{stats.compat ? ' (compat)' : ''}, tier {stats.tier} · {stats.drawCalls} draws,
					{stats.triangles} triangles · textures {mb(stats.texturesBytes)} · {stats.adapter ?? ''}
				</p>
				<p class="muted">?backend=webgl and ?tier=low…ultra switch them.</p>
			{/if}
		</aside>
	{/if}
</div>

<style>
	.page {
		display: grid;
		grid-template-columns: 16rem 1fr 20rem;
		height: 100vh;
		background: var(--bg);
		color: var(--text);
		font-family: var(--font-ui);
	}
	.page.thumb {
		display: block;
	}
	aside {
		overflow-y: auto;
		padding: 0.75rem;
		border-right: 1px solid var(--border);
		font-size: var(--fs-sm);
	}
	.facts {
		border-right: 0;
		border-left: 1px solid var(--border);
	}
	h1 {
		font-size: 1.1rem;
		margin: 0 0 0.5rem;
	}
	h2 {
		font-size: 1rem;
	}
	.models {
		list-style: none;
		padding: 0;
	}
	.models button {
		width: 100%;
		text-align: left;
		background: none;
		border: 0;
		color: inherit;
		padding: 0.15rem 0.3rem;
		cursor: pointer;
	}
	.models button.on {
		background: var(--accent-wash);
		color: var(--accent);
	}
	.stage {
		position: relative;
		min-width: 0;
	}
	.thumb .stage {
		width: var(--size);
		height: var(--size);
	}
	canvas {
		display: block;
		width: 100%;
		height: 100%;
	}
	dt {
		color: var(--muted);
		margin-top: 0.4rem;
	}
	dd {
		margin: 0;
	}
	.muted {
		color: var(--muted);
	}
	.danger {
		color: var(--danger);
	}
	fieldset {
		border: 1px solid var(--border);
	}
</style>
