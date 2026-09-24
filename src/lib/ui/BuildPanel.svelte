<script lang="ts" module>
	export type BuildTool = 'select' | 'wall' | 'door' | 'erase' | 'reveal' | 'hide';
</script>

<script lang="ts">
	interface Props {
		tool: BuildTool;
		fogEnabled: boolean;
		onTool(tool: BuildTool): void;
		onFog(enabled: boolean): void;
		onFogAll(reveal: boolean): void;
	}

	let { tool, fogEnabled, onTool, onFog, onFogAll }: Props = $props();

	const BUILD: { id: BuildTool; label: string; key: string }[] = [
		{ id: 'select', label: 'Select', key: 'V' },
		{ id: 'wall', label: 'Wall', key: 'W' },
		{ id: 'door', label: 'Door', key: 'D' },
		{ id: 'erase', label: 'Erase', key: 'E' }
	];
	const FOG: { id: BuildTool; label: string; key: string }[] = [
		{ id: 'reveal', label: 'Reveal', key: 'R' },
		{ id: 'hide', label: 'Hide', key: 'H' }
	];
</script>

{#snippet toolButton(t: { id: BuildTool; label: string; key: string })}
	<button
		type="button"
		aria-pressed={tool === t.id}
		title={`${t.label} (${t.key})`}
		onclick={() => onTool(t.id)}
	>
		{t.label}
		<kbd>{t.key}</kbd>
	</button>
{/snippet}

<section aria-label="Build tools">
	<h2>Build</h2>
	<div class="tools four" role="toolbar" aria-label="Build tools">
		{#each BUILD as t (t.id)}{@render toolButton(t)}{/each}
	</div>

	<div class="fog">
		<label class="switch">
			<input
				type="checkbox"
				checked={fogEnabled}
				onchange={(e) => onFog(e.currentTarget.checked)}
			/>
			<span>Fog of war</span>
		</label>
		{#if fogEnabled}
			<div class="tools two" role="toolbar" aria-label="Fog tools">
				{#each FOG as t (t.id)}{@render toolButton(t)}{/each}
			</div>
			<div class="all">
				<button type="button" onclick={() => onFogAll(true)}>Reveal all</button>
				<button type="button" onclick={() => onFogAll(false)}>Hide all</button>
			</div>
		{/if}
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
		gap: 0.3rem;
	}

	.four {
		grid-template-columns: repeat(4, 1fr);
	}

	.two {
		grid-template-columns: repeat(2, 1fr);
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

	.fog {
		display: grid;
		gap: 0.4rem;
		margin-top: 0.6rem;
		padding-top: 0.6rem;
		border-top: 1px solid var(--border);
	}

	.switch {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		cursor: pointer;
	}

	.switch input {
		accent-color: var(--accent);
		width: 1rem;
		height: 1rem;
	}

	.all {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.3rem;
	}

	.all button {
		font-size: 0.78rem;
	}
</style>
