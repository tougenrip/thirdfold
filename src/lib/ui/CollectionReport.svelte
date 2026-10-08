<script lang="ts">
	import type { CollectionReport, DependencyStatus } from '$lib/game/collection';

	/** A collection and what the server found of everything it names. */
	interface Props {
		report: CollectionReport;
	}

	let { report }: Props = $props();

	const KIND: Record<string, string> = {
		rules: 'Rules',
		adventure: 'Adventure',
		pack: 'Homebrew',
		table: 'Table'
	};
	const STATUS: Record<DependencyStatus, string> = {
		ok: 'Ready',
		missing: 'Missing',
		unavailable: 'Unavailable',
		incompatible: 'Doesn’t fit',
		invalid: 'Broken'
	};
	const bad = $derived(report.items.filter((i) => i.status !== 'ok').length);
</script>

<section class="report" aria-label="What the collection holds">
	<p class="summary" class:ok={report.ok} role="status">
		{report.ok
			? 'Everything it names is here and plays by the same rules: it’s ready to run.'
			: `${bad} of ${report.items.length} ${report.items.length === 1 ? 'piece' : 'pieces'} can’t be used, so it can’t be run yet.`}
	</p>
	<ul>
		{#each report.items as item, i (i)}
			<li class={item.status}>
				<span class="kind">{KIND[item.kind] ?? item.kind}</span>
				<span class="what">
					<strong>{item.title ?? item.ref}</strong>
					{#if item.version !== null && item.kind !== 'rules'}<span class="muted"
							>version {item.version}</span
						>{/if}
					{#if item.message}<span class="message">{item.message}</span>{/if}
				</span>
				<span class="status">{STATUS[item.status]}</span>
			</li>
		{/each}
	</ul>
</section>

<style>
	.report {
		display: grid;
		gap: var(--sp-4);
	}
	.summary {
		margin: 0;
		color: var(--danger);
	}
	.summary.ok {
		color: var(--muted);
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: var(--sp-3);
	}
	li {
		display: grid;
		grid-template-columns: 6.5rem 1fr auto;
		gap: var(--sp-4);
		align-items: baseline;
		padding: var(--sp-3) 0;
		border-bottom: 1px solid var(--border);
	}
	.kind {
		font-size: var(--fs-xs);
		color: var(--muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	.what {
		display: grid;
		gap: var(--sp-1);
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.muted,
	.message {
		font-size: var(--fs-sm);
		color: var(--muted);
	}
	li:not(.ok) .message,
	li:not(.ok) .status {
		color: var(--danger);
	}
	.status {
		font-size: var(--fs-sm);
		white-space: nowrap;
	}
	@media (max-width: 30rem) {
		li {
			grid-template-columns: 1fr auto;
		}
		.kind {
			grid-column: 1 / -1;
		}
	}
</style>
