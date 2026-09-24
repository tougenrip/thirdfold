<script lang="ts">
	import {
		normalizeSceneName,
		SCENE_FILE_MAX_BYTES,
		SCENE_NAME_MAX_LENGTH
	} from '$lib/game/scene-file';
	import type { RoomAction, SceneReply } from '$lib/net/room-connection.svelte';
	import { loadSavedScenes, storeSavedScenes, type SavedSceneRef } from '$lib/prefs';

	interface Props {
		/** The room's current scene name; the name box follows it. */
		sceneName: string;
		reply: SceneReply | null;
		send(action: RoomAction): boolean;
		onError(message: string): void;
	}

	let { sceneName, reply, send, onError }: Props = $props();

	// Follows the table's scene (after a load, import or reconnect) but stays editable in between.
	let name = $derived(sceneName);
	let saved = $state<SavedSceneRef[]>(loadSavedScenes());
	/** Scene waiting for a second click to confirm replacing the table. */
	let confirming = $state<string | null>(null);
	let fileInput: HTMLInputElement;
	let lastHandled = 0;

	const date = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

	// Replies from the server: remember a save; download an export.
	$effect(() => {
		if (!reply || reply.seq === lastHandled) return;
		lastHandled = reply.seq;
		if (reply.type === 'scene_saved') {
			const entry = { sceneId: reply.sceneId, name: reply.name, savedAt: reply.savedAt };
			saved = [entry, ...saved.filter((s) => s.sceneId !== entry.sceneId)];
			storeSavedScenes(saved);
		} else {
			download(reply.file.name, JSON.stringify(reply.file, null, 2));
		}
	});

	function download(sceneName: string, json: string) {
		const blob = new Blob([json], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `${sceneName.replace(/[^\w.-]+/g, '_') || 'scene'}.thirdfold.json`;
		a.click();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}

	function currentName(): string | null {
		const n = normalizeSceneName(name);
		if (!n) onError(`Scene names are 1-${SCENE_NAME_MAX_LENGTH} characters.`);
		return n;
	}

	function save(event: SubmitEvent) {
		event.preventDefault();
		const n = currentName();
		if (n) send({ type: 'scene_save', name: n });
	}

	function exportFile() {
		const n = currentName();
		if (n) send({ type: 'scene_export', name: n });
	}

	function load(scene: SavedSceneRef) {
		if (confirming !== scene.sceneId) {
			confirming = scene.sceneId;
			return;
		}
		confirming = null;
		send({ type: 'scene_load', sceneId: scene.sceneId });
	}

	function forget(scene: SavedSceneRef) {
		saved = saved.filter((s) => s.sceneId !== scene.sceneId);
		storeSavedScenes(saved);
	}

	async function importFile(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		if (file.size > SCENE_FILE_MAX_BYTES) return onError('That file is too large to be a scene.');
		let data: unknown;
		try {
			data = JSON.parse(await file.text());
		} catch {
			return onError('That file is not a thirdfold scene (not JSON).');
		}
		if (typeof data !== 'object' || data === null) {
			return onError('That file is not a thirdfold scene.');
		}
		// The server validates every field; this only ships the data.
		send({ type: 'scene_import', file: data });
	}
</script>

<section aria-label="Scene">
	<h2>Scene</h2>
	<form class="save" onsubmit={save}>
		<input bind:value={name} maxlength={SCENE_NAME_MAX_LENGTH} aria-label="Scene name" />
		<button class="primary" type="submit">Save</button>
	</form>

	{#if saved.length > 0}
		<ul class="saved" aria-label="Saved scenes">
			{#each saved as scene (scene.sceneId)}
				<li>
					<span class="info">
						<span class="name">{scene.name}</span>
						<span class="when">{date.format(new Date(scene.savedAt))}</span>
					</span>
					<button
						type="button"
						class:warn={confirming === scene.sceneId}
						onclick={() => load(scene)}
						onblur={() => confirming === scene.sceneId && (confirming = null)}
					>
						{confirming === scene.sceneId ? 'Replace table?' : 'Load'}
					</button>
					<button
						type="button"
						class="forget"
						aria-label={`Forget ${scene.name}`}
						title="Forget (the save stays on the server)"
						onclick={() => forget(scene)}>×</button
					>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="muted">Saved scenes appear here, in this browser.</p>
	{/if}

	<div class="files">
		<button type="button" onclick={exportFile}>Export file</button>
		<button type="button" onclick={() => fileInput.click()}>Import file</button>
		<input
			bind:this={fileInput}
			type="file"
			accept=".json,application/json"
			hidden
			onchange={importFile}
		/>
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

	.save {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 0.4rem;
	}

	.saved {
		list-style: none;
		margin: 0.5rem 0 0;
		padding: 0;
		display: grid;
		gap: 0.3rem;
		max-height: 9rem;
		overflow-y: auto;
	}

	li {
		display: flex;
		align-items: center;
		gap: 0.35rem;
	}

	.info {
		flex: 1;
		min-width: 0;
		display: grid;
	}

	.name,
	.when {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.when {
		font-size: 0.72rem;
		color: var(--muted);
	}

	li button {
		padding: 0.25rem 0.5rem;
		font-size: 0.8rem;
	}

	.warn {
		border-color: var(--danger);
		color: var(--danger);
	}

	.forget {
		color: var(--muted);
	}

	.muted {
		margin: 0.5rem 0 0;
		color: var(--muted);
		font-size: 0.85rem;
	}

	.files {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.3rem;
		margin-top: 0.6rem;
	}

	.files button {
		font-size: 0.8rem;
	}
</style>
