<script lang="ts" module>
	export type BuildTool = 'select' | 'wall' | 'door' | 'erase';
</script>

<script lang="ts">
	let { tool, onTool }: { tool: BuildTool; onTool(tool: BuildTool): void } = $props();

	const TOOLS: { id: BuildTool; label: string; key: string }[] = [
		{ id: 'select', label: 'Select', key: 'V' },
		{ id: 'wall', label: 'Wall', key: 'W' },
		{ id: 'door', label: 'Door', key: 'D' },
		{ id: 'erase', label: 'Erase', key: 'E' }
	];
</script>

<section aria-label="Build tools">
	<h2>Build</h2>
	<div class="tools" role="toolbar" aria-label="Build tools">
		{#each TOOLS as t (t.id)}
			<button
				type="button"
				aria-pressed={tool === t.id}
				title={`${t.label} (${t.key})`}
				onclick={() => onTool(t.id)}
			>
				{t.label}
				<kbd>{t.key}</kbd>
			</button>
		{/each}
	</div>
</section>

<style>
	h2 {
		margin: 0 0 0.5rem;
		font-size: 0.8rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--muted);
	}

	.tools {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 0.3rem;
	}

	button {
		display: grid;
		justify-items: center;
		gap: 0.1rem;
		padding: 0.35rem 0.2rem;
		font-size: 0.82rem;
	}

	button[aria-pressed='true'] {
		border-color: var(--accent);
		color: var(--accent);
	}

	kbd {
		font-family: ui-monospace, monospace;
		font-size: 0.65rem;
		color: var(--muted);
	}
</style>
