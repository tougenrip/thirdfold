<script lang="ts">
	import { normalizeSceneName, SCENE_NAME_MAX_LENGTH } from '$lib/game/file-limits';
	import { NEW_TABLE_LIMITS } from '$lib/game/protocol';
	import { canonicalTime, type WorldPatch } from '$lib/game/world';
	import { loadManifest } from '$lib/assets/load';
	import type { RoomAction } from '$lib/net/room-connection.svelte';

	/** The Scene panel's form for a new, empty table: name, size, look and starting hour. */
	interface Props {
		send(action: RoomAction): boolean;
		onError(message: string): void;
		onDone(): void;
	}

	let { send, onError, onDone }: Props = $props();

	let newName = $state('New table');
	let newWidth = $state(20);
	let newHeight = $state(20);
	let newLook = $state('');
	// Underground starts in the day band like any new table; the GM darkens it with the band radios.
	const STARTS: [string, WorldPatch][] = [
		['Day', { time: canonicalTime('day') }],
		['Dusk', { time: canonicalTime('dusk') }],
		['Night', { time: canonicalTime('dark') }],
		['Underground', { sun: false }]
	];
	let newStart = $state(0);
	let environments = $state<[string, string][]>([]);
	$effect(() => {
		void loadManifest().then((m) => {
			environments = Object.entries(m.environments).map(([id, e]) => [id, e.name]);
		});
	});
	const sizeOk = (n: number) =>
		Number.isInteger(n) && n >= NEW_TABLE_LIMITS.min && n <= NEW_TABLE_LIMITS.max;

	function createTable(event: SubmitEvent) {
		event.preventDefault();
		const n = normalizeSceneName(newName);
		if (!n) return onError(`Scene names are 1-${SCENE_NAME_MAX_LENGTH} characters.`);
		if (!sizeOk(newWidth) || !sizeOk(newHeight)) {
			return onError(
				`Tables are ${NEW_TABLE_LIMITS.min} to ${NEW_TABLE_LIMITS.max} cells on a side.`
			);
		}
		send({
			type: 'scene_new',
			name: n,
			width: newWidth,
			height: newHeight,
			environment: newLook || null,
			world: STARTS[newStart][1]
		});
		onDone();
	}
</script>

<form class="new" onsubmit={createTable} aria-label="New table">
	<label>
		<span class="muted">Name</span>
		<input bind:value={newName} maxlength={SCENE_NAME_MAX_LENGTH} />
	</label>
	<div class="size">
		<label>
			<span class="muted">Width</span>
			<input
				type="number"
				min={NEW_TABLE_LIMITS.min}
				max={NEW_TABLE_LIMITS.max}
				bind:value={newWidth}
			/>
		</label>
		<label>
			<span class="muted">Height</span>
			<input
				type="number"
				min={NEW_TABLE_LIMITS.min}
				max={NEW_TABLE_LIMITS.max}
				bind:value={newHeight}
			/>
		</label>
	</div>
	<label>
		<span class="muted">Looks like</span>
		<select bind:value={newLook}>
			<option value="">Plain ground</option>
			{#each environments as [id, envName] (id)}
				<option value={id}>{envName}</option>
			{/each}
		</select>
	</label>
	<label>
		<span class="muted">Starting look</span>
		<select bind:value={newStart}>
			{#each STARTS as [label], i (label)}<option value={i}>{label}</option>{/each}
		</select>
	</label>
	<p class="muted">An empty table replaces this one (save first to keep it).</p>
	<button class="primary" type="submit">Create table</button>
</form>

<style>
	.new {
		display: grid;
		gap: var(--sp-3);
		margin-top: var(--sp-4);
		padding: var(--sp-4);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
	}

	.new label {
		display: grid;
		gap: var(--sp-1);
	}

	.muted {
		margin: 0;
		color: var(--muted);
		font-size: var(--fs-sm);
	}

	.size {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--sp-3);
	}

	.size input {
		min-width: 0;
	}
</style>
