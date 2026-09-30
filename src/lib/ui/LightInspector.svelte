<script lang="ts">
	import {
		FLICKERS,
		LIGHT_COLORS,
		LIGHT_KINDS,
		lightKindName,
		lightLook,
		MAX_LIGHT_HEIGHT,
		MAX_LIGHT_INTENSITY,
		MAX_LIGHT_RADIUS,
		type Flicker,
		type Light,
		type LightKind
	} from '$lib/game/lights';
	import type { LightPatch } from '$lib/game/protocol';
	import type { RoomAction } from '$lib/net/room-connection.svelte';

	interface Props {
		light: Light;
		send(action: RoomAction): boolean;
		onDone(): void;
		/** Removes the light (the room view offers an undo). */
		onRemove(): void;
	}

	let { light, send, onDone, onRemove }: Props = $props();

	/** Its whole look: its own fields over its kind's. */
	const look = $derived(lightLook(light));
	const FLICKER_LABEL: Record<Flicker, string> = {
		none: 'Steady',
		candle: 'Candle',
		torch: 'Torch',
		fire: 'Fire',
		pulse: 'Pulse'
	};

	/** One change, one field. */
	const update = (patch: LightPatch) => send({ type: 'light_update', lightId: light.id, patch });
</script>

<section aria-label="Selected light">
	<h2 class="section-title">{lightKindName(look.kind)}</h2>
	<p class="muted">
		At {light.pos.x + 1}, {light.pos.y + 1}. <kbd>Del</kbd> removes, <kbd>Esc</kbd> lets go.
	</p>
	<label class="check">
		<input
			type="checkbox"
			checked={light.on}
			onchange={(e) => update({ on: e.currentTarget.checked })}
		/>
		<span>Lit</span>
	</label>
	<label class="field">
		<span class="muted">Kind</span>
		<select
			value={look.kind}
			onchange={(e) => update({ kind: e.currentTarget.value as LightKind })}
		>
			{#each LIGHT_KINDS as kind (kind)}
				<option value={kind}>{lightKindName(kind)}</option>
			{/each}
		</select>
	</label>
	<div class="field">
		<span class="muted" id="light-colour">Colour</span>
		<div class="swatches" role="group" aria-labelledby="light-colour">
			{#each LIGHT_COLORS as c (c.color)}
				<button
					type="button"
					class="swatch"
					style:background={c.color}
					title={c.name}
					aria-label={c.name}
					aria-pressed={light.color === c.color}
					onclick={() => update({ color: c.color })}
				></button>
			{/each}
			<input
				type="color"
				value={light.color}
				aria-label="Any colour"
				onchange={(e) => update({ color: e.currentTarget.value })}
			/>
		</div>
	</div>
	<label class="field">
		<span class="muted num">Radius {light.radius} {light.radius === 1 ? 'cell' : 'cells'}</span>
		<input
			type="range"
			min="1"
			max={MAX_LIGHT_RADIUS}
			step="1"
			value={light.radius}
			onchange={(e) => update({ radius: e.currentTarget.valueAsNumber })}
		/>
	</label>
	<label class="field">
		<span class="muted num">Intensity ×{look.intensity.toFixed(2)}</span>
		<input
			type="range"
			min="0"
			max={MAX_LIGHT_INTENSITY}
			step="0.25"
			value={look.intensity}
			onchange={(e) => update({ intensity: e.currentTarget.valueAsNumber })}
		/>
	</label>
	<label class="field">
		<span class="muted num">Height {look.height} {look.height === 1 ? 'level' : 'levels'}</span>
		<input
			type="range"
			min="0"
			max={MAX_LIGHT_HEIGHT}
			step="1"
			value={look.height}
			onchange={(e) => update({ height: e.currentTarget.valueAsNumber })}
		/>
	</label>
	<label class="field">
		<span class="muted">Flicker</span>
		<select
			value={look.flicker}
			onchange={(e) => update({ flicker: e.currentTarget.value as Flicker })}
		>
			{#each FLICKERS as flicker (flicker)}
				<option value={flicker}>{FLICKER_LABEL[flicker]}</option>
			{/each}
		</select>
	</label>
	<label class="check">
		<input
			type="checkbox"
			checked={look.shadows}
			onchange={(e) => update({ shadows: e.currentTarget.checked })}
		/>
		<span>Casts shadows</span>
	</label>
	<label class="check">
		<input
			type="checkbox"
			checked={look.fixture}
			onchange={(e) => update({ fixture: e.currentTarget.checked })}
		/>
		<span>Draw a fixture</span>
	</label>
	<div class="row">
		<button type="button" onclick={onDone}>Done</button>
		<button type="button" class="danger" onclick={onRemove}>Remove</button>
	</div>
</section>

<style>
	h2 {
		margin: 0 0 var(--sp-3);
	}

	.muted {
		margin: 0 0 var(--sp-4);
		color: var(--muted);
		font-size: var(--fs-xs);
	}

	.field {
		display: grid;
		gap: var(--sp-2);
		margin-bottom: var(--sp-4);
		font-size: var(--fs-xs);
	}

	.field .muted {
		margin: 0;
	}

	.field input[type='range'] {
		accent-color: var(--accent);
		padding: 0;
	}

	.check {
		display: flex;
		align-items: center;
		gap: var(--sp-3);
		margin: 0 0 var(--sp-3);
		font-size: var(--fs-sm);
	}

	.swatches {
		display: flex;
		align-items: center;
		gap: var(--sp-3);
	}

	.swatch {
		flex: none;
		width: 1.75rem;
		height: 1.75rem;
		min-height: 0;
		padding: 0;
		border-radius: 50%;
		border: 2px solid transparent;
	}

	.swatch[aria-pressed='true'] {
		border-color: var(--text);
	}

	.swatches input {
		width: 2.25rem;
		height: 1.75rem;
		min-height: 0;
		padding: 0.15rem;
	}

	.row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--sp-3);
		margin-top: var(--sp-4);
	}

	.row button {
		font-size: var(--fs-xs);
	}
</style>
