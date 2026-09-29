<script lang="ts">
	import { resolve } from '$app/paths';
	import { loadManifest } from '$lib/assets/load';
	import type { Credit, Manifest } from '$lib/assets/manifest';
	import { SHIPPED, SRD_ATTRIBUTION, type Shipped } from '$lib/credits';

	// Everything here comes from the asset manifest (each file's credit, #189)
	// and the hand list of shipped code and fonts in $lib/credits.

	const LICENSE_NAMES: Record<Credit['license'], string> = {
		'CC0-1.0': 'CC0 1.0 (public domain)',
		'CC-BY-4.0': 'CC BY 4.0',
		'LicenseRef-thirdfold-commissioned': 'Commissioned for thirdfold',
		'LicenseRef-thirdfold-original': 'thirdfold originals'
	};

	interface Row {
		name: string;
		credit: Credit;
	}

	let manifest = $state<Manifest | null>(null);
	loadManifest().then((m) => (manifest = m));

	/** Every file's credit, named by its asset id. */
	const rows = $derived.by((): Row[] => {
		if (!manifest) return [];
		const out: Row[] = [];
		for (const [id, m] of Object.entries(manifest.models)) out.push({ name: id, credit: m.credit });
		for (const [id, t] of Object.entries(manifest.textures)) {
			if (!id.startsWith('grade-')) out.push({ name: id, credit: t.credit });
		}
		for (const [id, a] of Object.entries(manifest.audio)) out.push({ name: id, credit: a.credit });
		return out;
	});
	const originals = $derived(
		rows.filter((r) => r.credit.license === 'LicenseRef-thirdfold-original').length
	);
	/** Other licences, then author, each with the assets they cover. */
	const groups = $derived.by(() => {
		const out: { license: Credit['license']; authors: { author: string; items: Row[] }[] }[] = [];
		for (const r of rows) {
			const { license, author } = r.credit;
			if (license === 'LicenseRef-thirdfold-original') continue;
			let g = out.find((g) => g.license === license);
			if (!g) out.push((g = { license, authors: [] }));
			let a = g.authors.find((a) => a.author === author);
			if (!a) g.authors.push((a = { author, items: [] }));
			a.items.push(r);
		}
		return out;
	});
	const assisted = $derived(rows.filter((r) => r.credit.ai));
	const ofKind = (kind: Shipped['kind']) => SHIPPED.filter((s) => s.kind === kind);
</script>

<svelte:head>
	<title>Credits · thirdfold</title>
</svelte:head>

{#snippet shipped(kind: Shipped['kind'], heading: string)}
	<section>
		<h2>{heading}</h2>
		<ul>
			{#each ofKind(kind) as s (s.name)}
				<li>
					<a href={s.url} rel="external noopener">{s.name}</a>
					<span class="licence">{s.license}</span>
					{#if s.note}<span class="muted">{s.note}</span>{/if}
				</li>
			{/each}
		</ul>
	</section>
{/snippet}

<main>
	<nav class="back"><a href={resolve('/')}>← thirdfold</a></nav>
	<h1>Credits</h1>
	<p class="lead">Who made what thirdfold is built from, and on what terms.</p>

	<section aria-busy={manifest === null}>
		<h2>Art and sound</h2>
		{#if !manifest}
			<p class="muted">Reading the asset list…</p>
		{:else}
			<p>{LICENSE_NAMES['LicenseRef-thirdfold-original']}: {originals} assets.</p>
			{#each groups as g (g.license)}
				<h3>{LICENSE_NAMES[g.license]}</h3>
				<ul>
					{#each g.authors as a (a.author)}
						<li>
							<strong>{a.author}</strong>:
							{#each a.items as item, i (item.name)}
								{#if i > 0},
								{/if}
								{#if item.credit.source}
									<a href={item.credit.source} rel="external noopener">{item.name}</a>
								{:else}
									{item.name}
								{/if}
								{#if item.credit.modified}<span class="muted">(modified)</span>{/if}
							{/each}
						</li>
					{/each}
				</ul>
			{/each}
			<h3>AI-assisted assets</h3>
			{#if assisted.length}
				<p>These were made with a generator, then cleaned up and repainted by hand:</p>
				<ul>
					{#each assisted as r (r.name)}
						<li>{r.name} <span class="muted">({r.credit.ai?.tool})</span></li>
					{/each}
				</ul>
			{:else}
				<p class="muted">None.</p>
			{/if}
		{/if}
	</section>

	{@render shipped('code', 'Code')}
	{@render shipped('font', 'Fonts')}
	{@render shipped('tool', 'Build tools')}

	{#if SRD_ATTRIBUTION}
		<section>
			<h2>Rules</h2>
			<p>{SRD_ATTRIBUTION}</p>
		</section>
	{/if}
</main>

<style>
	main {
		max-width: 48rem;
		margin: 0 auto;
		padding: var(--sp-8) clamp(var(--sp-6), 4vw, var(--sp-8)) calc(var(--sp-8) * 2);
	}

	.back {
		margin: 0 0 var(--sp-6);
	}

	h1 {
		margin: 0;
		font-size: var(--fs-2xl);
	}

	.lead {
		margin: var(--sp-3) 0 var(--sp-8);
		color: var(--muted);
	}

	section {
		margin-top: var(--sp-8);
		border-top: 1px solid var(--border);
		padding-top: var(--sp-6);
	}

	h2 {
		margin: 0 0 var(--sp-5);
		font-size: var(--fs-xl);
	}

	h3 {
		margin: var(--sp-7) 0 var(--sp-4);
		font-size: var(--fs-lg);
	}

	ul {
		display: grid;
		gap: var(--sp-4);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.licence {
		margin: 0 var(--sp-4);
		font-size: var(--fs-sm);
	}

	.muted {
		color: var(--muted);
	}
</style>
