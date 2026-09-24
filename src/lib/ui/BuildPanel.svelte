<script lang="ts" module>
	import type { AssetId, Rotation } from '$lib/game/props';

	export type BuildTool =
		| 'select'
		| 'wall'
		| 'door'
		| 'erase'
		| 'reveal'
		| 'hide'
		| 'reveal-room'
		| 'hide-room'
		| 'light'
		| 'prop'
		| 'height';

	/** The prop the GM is about to place. */
	export interface PropDraft {
		assetId: AssetId;
		rotation: Rotation;
	}

	/** Settings for the next light the GM places. */
	export interface LightDraft {
		radius: number;
		color: string;
	}
</script>

<script lang="ts">
	import { AMBIENTS, LIGHT_COLORS, MAX_LIGHT_RADIUS, type Ambient } from '$lib/game/lights';
	import { ASSET_IDS, ASSETS } from '$lib/game/props';
	import { MAX_LEVEL } from '$lib/game/terrain';
	import { WALL_LEVELS } from '$lib/game/visibility';

	interface Props {
		tool: BuildTool;
		fogEnabled: boolean;
		/** Whether players see through the whole party's eyes. */
		fogShared: boolean;
		ambient: Ambient;
		lightDraft: LightDraft;
		propDraft: PropDraft;
		onTool(tool: BuildTool): void;
		onFog(enabled: boolean): void;
		onFogAll(reveal: boolean): void;
		onFogShared(shared: boolean): void;
		onAmbient(ambient: Ambient): void;
		onLightDraft(draft: LightDraft): void;
		onPropDraft(draft: PropDraft): void;
		/** The level the height tool sets cells to. */
		heightLevel: number;
		onHeightLevel(level: number): void;
	}

	let {
		tool,
		fogEnabled,
		fogShared,
		ambient,
		lightDraft,
		propDraft,
		onTool,
		onFog,
		onFogAll,
		onFogShared,
		onAmbient,
		onLightDraft,
		onPropDraft,
		heightLevel,
		onHeightLevel
	}: Props = $props();

	const BLOCKS_HINT = { none: 'walk over', movement: 'blocks movement', sight: 'blocks sight' };

	const AMBIENT_LABEL: Record<Ambient, string> = { day: 'Day', dusk: 'Dusk', dark: 'Dark' };

	const BUILD: { id: BuildTool; label: string; key: string }[] = [
		{ id: 'select', label: 'Select', key: 'V' },
		{ id: 'wall', label: 'Wall', key: 'W' },
		{ id: 'door', label: 'Door', key: 'D' },
		{ id: 'erase', label: 'Erase', key: 'E' }
	];
	const FOG: { id: BuildTool; label: string; key: string }[] = [
		{ id: 'reveal', label: 'Reveal', key: 'R' },
		{ id: 'hide', label: 'Hide', key: 'H' },
		{ id: 'reveal-room', label: 'Reveal room', key: 'O' },
		{ id: 'hide-room', label: 'Hide room', key: 'K' }
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

	<div class="section">
		{@render toolButton({ id: 'prop', label: 'Place prop', key: 'P' })}
		{#if tool === 'prop'}
			<div class="palette" role="radiogroup" aria-label="Prop">
				{#each ASSET_IDS as id (id)}
					<button
						type="button"
						role="radio"
						aria-checked={propDraft.assetId === id}
						title={`${ASSETS[id].name}: ${BLOCKS_HINT[ASSETS[id].blocks]}`}
						onclick={() => onPropDraft({ ...propDraft, assetId: id })}>{ASSETS[id].name}</button
					>
				{/each}
			</div>
			<button
				type="button"
				title="Rotate ( [ or ] )"
				onclick={() =>
					onPropDraft({ ...propDraft, rotation: ((propDraft.rotation + 1) % 4) as Rotation })}
				>Rotate ⟳ ({propDraft.rotation * 90}°)</button
			>
		{/if}
	</div>

	<div class="section">
		<div class="ambient" role="radiogroup" aria-label="Lighting">
			{#each AMBIENTS as a (a)}
				<button type="button" role="radio" aria-checked={ambient === a} onclick={() => onAmbient(a)}
					>{AMBIENT_LABEL[a]}</button
				>
			{/each}
		</div>
		{@render toolButton({ id: 'height', label: 'Shape ground', key: 'G' })}
		{#if tool === 'height'}
			<label class="row">
				<span class="muted">Level (0 floor, {WALL_LEVELS} a wall high)</span>
				<input
					type="number"
					min="0"
					max={MAX_LEVEL}
					value={heightLevel}
					aria-label="Ground level"
					onchange={(e) => {
						const level = Math.round(e.currentTarget.valueAsNumber);
						if (level >= 0 && level <= MAX_LEVEL) onHeightLevel(level);
					}}
				/>
			</label>
			<p class="muted">Click two corners of an area. Stairs rise one level a cell.</p>
		{/if}
		{@render toolButton({ id: 'light', label: 'Place light', key: 'L' })}
		{#if tool === 'light'}
			<label class="row">
				<span class="muted">Radius (cells)</span>
				<input
					type="number"
					min="1"
					max={MAX_LIGHT_RADIUS}
					value={lightDraft.radius}
					aria-label="Light radius"
					onchange={(e) => {
						const radius = Math.round(e.currentTarget.valueAsNumber);
						if (radius >= 1 && radius <= MAX_LIGHT_RADIUS) onLightDraft({ ...lightDraft, radius });
					}}
				/>
			</label>
			<div class="swatches" role="group" aria-label="Light colour">
				{#each LIGHT_COLORS as c (c.color)}
					<button
						type="button"
						class="swatch"
						style:background={c.color}
						title={c.name}
						aria-label={c.name}
						aria-pressed={lightDraft.color === c.color}
						onclick={() => onLightDraft({ ...lightDraft, color: c.color })}
					></button>
				{/each}
			</div>
		{/if}
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
			<label class="switch" title="Off: each player sees only through their own tokens.">
				<input
					type="checkbox"
					checked={fogShared}
					onchange={(e) => onFogShared(e.currentTarget.checked)}
				/>
				<span>Shared party sight</span>
			</label>
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

	.palette {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 0.25rem;
	}

	.palette button {
		font-size: 0.75rem;
		padding: 0.3rem 0.2rem;
	}

	.palette [aria-checked='true'] {
		border-color: var(--accent);
		color: var(--accent);
	}

	.section {
		display: grid;
		gap: 0.4rem;
		margin-top: 0.6rem;
		padding-top: 0.6rem;
		border-top: 1px solid var(--border);
	}

	.ambient {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 0.3rem;
	}

	.ambient button {
		font-size: 0.8rem;
	}

	.ambient [aria-checked='true'] {
		border-color: var(--accent);
		color: var(--accent);
	}

	.row {
		display: grid;
		grid-template-columns: 1fr 4.5rem;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.8rem;
	}

	.muted {
		color: var(--muted);
	}

	.swatches {
		display: flex;
		gap: 0.3rem;
	}

	.swatch {
		width: 1.4rem;
		height: 1.4rem;
		padding: 0;
		border-radius: 50%;
		border: 2px solid transparent;
	}

	.swatch[aria-pressed='true'] {
		border-color: var(--text);
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
