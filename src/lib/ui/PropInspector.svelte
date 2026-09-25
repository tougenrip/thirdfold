<script lang="ts">
	import { ASSETS, PROP_SCALE, type Prop, type Rotation } from '$lib/game/props';
	import type { RoomAction } from '$lib/net/room-connection.svelte';

	interface Props {
		prop: Prop;
		send(action: RoomAction): boolean;
		onDone(): void;
		/** Removes the prop (the room view offers an undo). */
		onRemove(): void;
	}

	let { prop, send, onDone, onRemove }: Props = $props();

	const turn = (by: 1 | -1) => ((prop.rotation + by + 4) % 4) as Rotation;
</script>

<section aria-label="Selected prop">
	<h2 class="section-title">{ASSETS[prop.assetId].name}</h2>
	<p class="muted">
		Click a cell to move it. <kbd>[</kbd> <kbd>]</kbd> rotate, <kbd>Del</kbd> removes.
	</p>
	<div class="row">
		<button
			type="button"
			title="Rotate left ([)"
			onclick={() => send({ type: 'prop_update', propId: prop.id, patch: { rotation: turn(-1) } })}
			>⟲ Rotate</button
		>
		<button
			type="button"
			title="Rotate right (])"
			onclick={() => send({ type: 'prop_update', propId: prop.id, patch: { rotation: turn(1) } })}
			>Rotate ⟳</button
		>
	</div>
	<label class="scale">
		<span class="muted num">Size ×{prop.scale.toFixed(2)}</span>
		<input
			type="range"
			min={PROP_SCALE.min}
			max={PROP_SCALE.max}
			step="0.25"
			value={prop.scale}
			aria-label="Prop size"
			onchange={(e) =>
				send({
					type: 'prop_update',
					propId: prop.id,
					patch: { scale: e.currentTarget.valueAsNumber }
				})}
		/>
	</label>
	<label class="hidden">
		<input
			type="checkbox"
			checked={prop.hidden === true}
			onchange={(e) =>
				send({
					type: 'prop_update',
					propId: prop.id,
					patch: { hidden: e.currentTarget.checked }
				})}
		/>
		<span>Hidden from players</span>
	</label>
	<div class="row">
		<button type="button" onclick={onDone}>Done</button>
		<button type="button" class="danger" onclick={onRemove}>Remove</button>
	</div>
</section>

<style>
	.hidden {
		display: flex;
		align-items: center;
		gap: var(--sp-3);
		margin: var(--sp-3) 0;
		font-size: var(--fs-sm);
	}

	h2 {
		margin: 0 0 var(--sp-3);
	}

	.muted {
		margin: 0 0 var(--sp-4);
		color: var(--muted);
		font-size: var(--fs-xs);
	}

	.row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--sp-3);
		margin-bottom: var(--sp-3);
	}

	.row button {
		font-size: var(--fs-xs);
	}

	.scale {
		display: grid;
		gap: var(--sp-2);
		margin-bottom: var(--sp-4);
		font-size: var(--fs-xs);
	}

	.scale input {
		accent-color: var(--accent);
		padding: 0;
	}
</style>
