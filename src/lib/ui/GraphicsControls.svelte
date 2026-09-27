<script lang="ts">
	import { untrack } from 'svelte';
	import { prefersReducedMotion } from 'svelte/motion';
	import type { ToneMapper } from '$lib/assets/manifest';
	import {
		OPTIONS,
		settingsFor,
		TIERS,
		withOverrides,
		type Backend,
		type GraphicsPrefs,
		type OptionKey,
		type Overrides,
		type Tier
	} from '$lib/tabletop/quality';

	/**
	 * The Graphics menu (#154): a quality preset, and apart from it the advanced options (resolution,
	 * antialiasing, ambient occlusion, bloom, the lens effects, shadows, frame rate), the tone mapper (#158), the
	 * compatibility backend and the power saver, as this viewer sets them for this browser. Choosing
	 * a preset sets every option to its values; changing an option afterwards keeps that change on
	 * top. Local only: nothing here reaches the room. `inline` opens it in place (the side sheet on
	 * phones) rather than under the header.
	 */
	let {
		graphics,
		effective = null,
		inline = false,
		onchange
	}: {
		graphics: GraphicsPrefs;
		/** What the table draws with now, once it has started. */
		effective?: { tier: Tier; backend: Backend } | null;
		inline?: boolean;
		onchange: (next: GraphicsPrefs) => void;
	} = $props();

	let open = $state(false);
	let toggle = $state<HTMLButtonElement>();
	/** Compatibility as it was when the page loaded: changing it takes a reload. */
	const loadedCompatibility = untrack(() => graphics.compatibility);

	const NAMES: Record<Tier, string> = {
		low: 'Low',
		medium: 'Medium',
		high: 'High',
		ultra: 'Ultra'
	};
	const HELP: Record<Tier, string> = {
		low: 'Lightest: fewer pixels and shadows, 30 frames a second.',
		medium: 'Balanced, for laptops and integrated graphics.',
		high: 'Sharper and fuller, for a dedicated graphics card.',
		ultra: 'Everything, for a strong graphics card on WebGPU.'
	};
	/** How light maps to the screen: a matter of taste, not cost; it applies at once. */
	const TONES: Record<ToneMapper, { name: string; help: string }> = {
		aces: { name: 'Filmic (ACES)', help: 'Punchy and warm: fire glows yellow-white.' },
		agx: {
			name: 'Soft (AgX)',
			help: 'Gentle highlights that keep their hue; a softer, cooler night.'
		},
		neutral: { name: 'True colour (Neutral)', help: 'Paint and materials as they are, warmer.' }
	};

	/** Ultra needs WebGPU with its core features. */
	const ultraOff = $derived(!!effective && effective.backend !== 'webgpu');

	/** The advanced options, as the menu names them and their values. */
	const ADVANCED: { key: OptionKey; name: string; labels: string[] }[] = [
		{ key: 'megapixels', name: 'Resolution', labels: ['1 MP', '2 MP', '3.7 MP', '8.3 MP (4K)'] },
		{ key: 'aa', name: 'Antialiasing', labels: ['Off', 'FXAA', 'MSAA 4×', 'TRAA'] },
		{ key: 'ao', name: 'Ambient occlusion', labels: ['Off', 'On'] },
		{ key: 'bloom', name: 'Bloom', labels: ['Off', 'On'] },
		{ key: 'vignette', name: 'Vignette', labels: ['Off', 'On'] },
		{ key: 'aberration', name: 'Chromatic aberration', labels: ['Off', 'On'] },
		{ key: 'grain', name: 'Film grain', labels: ['Off', 'On'] },
		{ key: 'grade', name: 'Colour grading', labels: ['Off', 'On'] },
		{ key: 'sunShadowSize', name: 'Shadows', labels: ['Low', 'Medium', 'High'] },
		{ key: 'fpsCap', name: 'Frame rate', labels: ['30', '60'] }
	];
	const backend = $derived(effective?.backend ?? 'webgpu');
	/** The preset's own values: the tier drawn now, else the one chosen, else medium. */
	const preset = $derived(
		settingsFor(effective?.tier ?? (graphics.tier === 'auto' ? 'medium' : graphics.tier), backend)
	);
	const current = $derived(withOverrides(preset, graphics.overrides, backend));
	const customised = $derived(Object.keys(graphics.overrides).length > 0);

	/** Sets options; one back at the preset's value is no longer an override. */
	function setOptions(values: Overrides): void {
		const overrides: Overrides = { ...graphics.overrides, ...values };
		for (const key of Object.keys(values) as OptionKey[])
			if (preset[key] === overrides[key]) delete overrides[key];
		onchange({ ...graphics, overrides });
	}
	const setOption = (key: OptionKey, index: number) => setOptions({ [key]: OPTIONS[key][index] });

	/** Clarity (#164): every lens effect off; AO, bloom and the grade stay, being light. */
	const CLARITY: Overrides = { vignette: false, aberration: false, grain: false };
	const clear = $derived(
		(Object.keys(CLARITY) as OptionKey[]).every((k) => current[k] === CLARITY[k])
	);
	/** Grain moves, so reduced motion keeps it off (post.ts) whatever is chosen here. */
	const still = (key: OptionKey) => key === 'grain' && prefersReducedMotion.current;

	function close(): void {
		open = false;
		toggle?.focus();
	}
</script>

<svelte:window onkeydown={(e) => open && e.key === 'Escape' && close()} />

<div class="graphics" class:inline>
	<button
		type="button"
		bind:this={toggle}
		aria-expanded={open}
		aria-label="Graphics settings"
		title="Graphics"
		onclick={() => (open = !open)}
	>
		Graphics
	</button>
	{#if open}
		<div class="menu" role="group" aria-label="Graphics">
			<fieldset>
				<legend>Preset{customised ? ' (customised)' : ''}</legend>
				<label>
					<input
						type="radio"
						name="tier"
						checked={graphics.tier === 'auto'}
						onchange={() => onchange({ ...graphics, tier: 'auto', overrides: {} })}
					/>
					Auto{effective && graphics.tier === 'auto' ? ` (${NAMES[effective.tier]})` : ''}
				</label>
				{#each TIERS as tier (tier)}
					<label>
						<input
							type="radio"
							name="tier"
							checked={graphics.tier === tier}
							disabled={tier === 'ultra' && ultraOff}
							onchange={() => onchange({ ...graphics, tier, overrides: {} })}
						/>
						{NAMES[tier]}
					</label>
				{/each}
				<p class="help">
					{graphics.tier === 'auto'
						? 'Picked for this device, and lowered if frames run slow.'
						: HELP[graphics.tier]}
					{#if ultraOff}Ultra needs WebGPU, which this table isn't using.{/if}
				</p>
			</fieldset>
			<details class="switch advanced" open={customised}>
				<summary>Advanced</summary>
				<button type="button" class="reset" aria-pressed={clear} onclick={() => setOptions(CLARITY)}
					>Clarity: no lens effects</button
				>
				{#each ADVANCED as option (option.key)}
					<label class="option">
						{option.name}
						<select
							value={(OPTIONS[option.key] as readonly unknown[]).indexOf(current[option.key])}
							disabled={still(option.key)}
							onchange={(e) => setOption(option.key, Number(e.currentTarget.value))}
						>
							{#each option.labels as label, i (label)}
								<option
									value={i}
									disabled={option.key === 'aa' && i === 2 && backend === 'webgpu-compat'}
									>{label}</option
								>
							{/each}
						</select>
					</label>
					{#if still(option.key)}
						<p class="help">Off while your device asks for reduced motion.</p>
					{/if}
				{/each}
				{#if customised}
					<button
						type="button"
						class="reset"
						onclick={() => onchange({ ...graphics, overrides: {} })}>Back to the preset</button
					>
				{/if}
			</details>
			<fieldset class="switch">
				<legend>Colour</legend>
				{#each Object.keys(TONES) as ToneMapper[] as tone (tone)}
					<label>
						<input
							type="radio"
							name="tone"
							checked={graphics.toneMapper === tone}
							onchange={() => onchange({ ...graphics, toneMapper: tone })}
						/>
						{TONES[tone].name}
					</label>
				{/each}
				<p class="help">{TONES[graphics.toneMapper].help}</p>
			</fieldset>
			<label class="switch">
				<input
					type="checkbox"
					checked={graphics.compatibility}
					onchange={(e) => onchange({ ...graphics, compatibility: e.currentTarget.checked })}
				/>
				Compatibility mode (WebGL2), for when the table draws wrongly or not at all
			</label>
			{#if graphics.compatibility !== loadedCompatibility}
				<p class="help">
					Applies when you reload.
					<button type="button" onclick={() => location.reload()}>Reload</button>
				</p>
			{/if}
			<label class="switch">
				<input
					type="checkbox"
					checked={graphics.powerSaver}
					onchange={(e) => onchange({ ...graphics, powerSaver: e.currentTarget.checked })}
				/>
				Power saver: no flickering flames or drifting mist
			</label>
		</div>
	{/if}
</div>

<style>
	.graphics {
		position: relative;
	}

	/* Like the Sound menu: just below the header bar, over the top of the side column. */
	.menu {
		position: fixed;
		top: calc(100% + var(--sp-4));
		right: 0;
		width: min(var(--side-w, 17rem), 100%);
		display: grid;
		gap: var(--sp-4);
		padding: var(--sp-5);
		/* Solid: a blur inside the bar's own blur doesn't reach the panels behind it. */
		background: var(--panel-solid);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-md);
		z-index: var(--z-overlay);
	}

	/* In the side sheet (phones): open in place, full width. */
	.inline .menu {
		position: static;
		width: auto;
		margin-top: var(--sp-3);
		box-shadow: none;
	}

	fieldset {
		display: grid;
		gap: var(--sp-2);
		margin: 0;
		padding: 0;
		border: 0;
	}

	legend {
		margin-bottom: var(--sp-2);
		font-size: var(--fs-sm);
		color: var(--muted);
	}

	label {
		display: flex;
		align-items: center;
		gap: var(--sp-3);
		font-size: var(--fs-sm);
	}

	/* A long label never squeezes its box. */
	label input {
		flex: none;
	}

	label:has(input:disabled) {
		color: var(--muted);
	}

	.switch {
		align-items: flex-start;
		padding-top: var(--sp-3);
		border-top: 1px solid var(--border);
	}

	.advanced {
		display: grid;
		gap: var(--sp-2);
	}

	.advanced summary {
		font-size: var(--fs-sm);
		color: var(--muted);
		cursor: pointer;
	}

	.option {
		justify-content: space-between;
	}

	/* One column of equal boxes. */
	.option select {
		width: 8.5rem;
	}

	.reset {
		justify-self: start;
		font-size: var(--fs-xs);
	}

	.help {
		margin: 0;
		font-size: var(--fs-xs);
		color: var(--muted);
	}
</style>
