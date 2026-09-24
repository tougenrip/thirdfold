<script lang="ts">
	import { ASSETS, PROP_SCALE, type Prop, type Rotation } from '$lib/game/props';
	import type { RoomAction } from '$lib/net/room-connection.svelte';

	interface Props {
		prop: Prop;
		send(action: RoomAction): boolean;
		onDone(): void;
	}

	let { prop, send, onDone }: Props = $props();

	const turn = (by: 1 | -1) => ((prop.rotation + by + 4) % 4) as Rotation;
</script>

<section aria-label="Selected prop">
	<h2>{ASSETS[prop.assetId].name}</h2>
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
		<span class="muted">Size ×{prop.scale.toFixed(2)}</span>
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
	<div class="row">
		<button type="button" onclick={onDone}>Done</button>
		<button
			type="button"
			class="danger"
			onclick={() => {
				send({ type: 'prop_delete', propId: prop.id });
				onDone();
			}}>Remove</button
		>
	</div>
</section>

<style>
	h2 {
		margin: 0 0 0.3rem;
		font-size: 0.8rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--accent);
	}

	.muted {
		margin: 0 0 0.5rem;
		color: var(--muted);
		font-size: 0.78rem;
	}

	kbd {
		font-family: ui-monospace, monospace;
		font-size: 0.72rem;
	}

	.row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.3rem;
		margin-bottom: 0.4rem;
	}

	.row button {
		font-size: 0.8rem;
	}

	.scale {
		display: grid;
		gap: 0.2rem;
		margin-bottom: 0.5rem;
		font-size: 0.8rem;
	}

	.scale input {
		accent-color: var(--accent);
		padding: 0;
	}

	.danger {
		border-color: var(--danger);
		color: var(--danger);
	}
</style>
