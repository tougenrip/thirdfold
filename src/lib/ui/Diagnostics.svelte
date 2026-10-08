<script lang="ts">
	import { hintOf, type Diagnostic } from '$lib/validation/diagnostics';

	/**
	 * What is wrong with a piece of content (milestone 56): each finding with
	 * where it is, what exactly, its code and how to fix it. The same list
	 * whether the builder found it or the server refused with it.
	 */
	interface Props {
		diagnostics: readonly Diagnostic[];
	}

	let { diagnostics }: Props = $props();
</script>

{#if diagnostics.length}
	<ul class="diagnostics">
		{#each diagnostics as d, i (i)}
			<li class={d.severity}>
				<div class="line">
					{#if d.path}<code class="path">{d.path}</code>{/if}
					<span>{d.message}</span>
				</div>
				<div class="hint">
					<span class="code">{d.code}</span>
					{hintOf(d.code)}
				</div>
			</li>
		{/each}
	</ul>
{/if}

<style>
	.diagnostics {
		margin: 0;
		padding: 0;
		list-style: none;
		display: grid;
		gap: var(--sp-2);
	}
	li {
		padding: var(--sp-2) var(--sp-3);
		border-left: 3px solid var(--danger);
		background: var(--surface-2, transparent);
		border-radius: var(--radius-sm, 4px);
		overflow-wrap: anywhere;
	}
	li.warning {
		border-left-color: var(--warn, var(--muted));
	}
	.line {
		display: flex;
		flex-wrap: wrap;
		gap: var(--sp-2);
		align-items: baseline;
	}
	.path {
		font-size: var(--fs-xs);
		color: var(--muted);
	}
	.hint {
		margin-top: var(--sp-1);
		font-size: var(--fs-xs);
		color: var(--muted);
	}
	.code {
		font-family: var(--font-mono, monospace);
		margin-right: var(--sp-1);
	}
</style>
