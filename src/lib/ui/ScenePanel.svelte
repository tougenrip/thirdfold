<script lang="ts">
	import {
		normalizeSceneName,
		SCENE_FILE_MAX_BYTES,
		SCENE_NAME_MAX_LENGTH
	} from '$lib/game/scene-file';
	import { NEW_TABLE_LIMITS, type SavedScene } from '$lib/game/protocol';
	import { loadManifest } from '$lib/assets/load';
	import { sharedCode, sharedLink } from './share';
	import type { RoomAction, SceneReply } from '$lib/net/room-connection.svelte';
	import { loadSavedScenes, storeSavedScenes, type SavedSceneRef } from '$lib/prefs';
	import { lastPlayed } from './when';

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
	/** The GM's saves, kept on the server under their GM key (any device). */
	let saves = $state<SavedScene[] | null>(null);
	/** Older saves this browser remembers, from before saves had owners; still loadable by id. */
	let saved = $state<SavedSceneRef[]>(loadSavedScenes());
	const older = $derived(saved.filter((s) => !saves?.some((x) => x.id === s.sceneId)));

	// Ask for the list once the panel is shown (and again after each save).
	$effect(() => {
		send({ type: 'scene_list' });
	});
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
			send({ type: 'scene_list' });
		} else if (reply.type === 'scene_list') {
			saves = reply.scenes;
		} else if (reply.type === 'scene_shared') {
			shared = { name: reply.name, link: sharedLink(location.origin, reply.code) };
			copied = false;
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

	function load(sceneId: string) {
		if (confirming !== sceneId) {
			confirming = sceneId;
			return;
		}
		confirming = null;
		send({ type: 'scene_load', sceneId });
	}

	function forget(scene: SavedSceneRef) {
		saved = saved.filter((s) => s.sceneId !== scene.sceneId);
		storeSavedScenes(saved);
	}

	/** Deletes one of the GM's saves for good (a second click confirms). */
	let deleting = $state<string | null>(null);
	function remove(scene: SavedScene) {
		if (deleting !== scene.id) {
			deleting = scene.id;
			return;
		}
		deleting = null;
		send({ type: 'scene_delete', sceneId: scene.id });
	}

	/** The table last shared: its name and the link that opens it. */
	let shared = $state<{ name: string; link: string } | null>(null);
	let copied = $state(false);

	function share() {
		const n = currentName();
		if (n) send({ type: 'scene_share', name: n });
	}

	async function copyLink() {
		if (!shared) return;
		try {
			await navigator.clipboard.writeText(shared.link);
			copied = true;
		} catch {
			onError('Copying failed: select the link and copy it.');
		}
	}

	/** A shared table's link or code, pasted to open it here. */
	let openCode = $state('');
	function openShared(event: SubmitEvent) {
		event.preventDefault();
		const code = sharedCode(openCode);
		if (!code) return onError('That is not a shared table link or code.');
		openCode = '';
		send({ type: 'scene_load', sceneId: code });
	}

	// A new, empty table.
	let creating = $state(false);
	let newName = $state('New table');
	let newWidth = $state(20);
	let newHeight = $state(20);
	let newLook = $state('');
	let environments = $state<[string, string][]>([]);
	$effect(() => {
		if (!creating) return;
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
			environment: newLook || null
		});
		creating = false;
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

	{#if saves === null}
		<p class="muted">Looking up your saves…</p>
	{:else if saves.length === 0 && older.length === 0}
		<p class="muted">Your saves appear here, on any device with your GM key.</p>
	{/if}
	{#if saves?.length}
		<ul class="saved" aria-label="Your saves">
			{#each saves as scene (scene.id)}
				<li>
					<span class="info">
						<span class="name">
							{scene.auto ? (scene.story?.title ?? scene.name) : scene.name}{#if scene.auto}<span
									class="auto"
								>
									· autosave</span
								>{/if}
						</span>
						<span class="when">
							{lastPlayed(scene.savedAt)}{scene.story
								? ` · ${scene.story.chapter}, ${scene.story.location}`
								: ''}
						</span>
					</span>
					<button
						type="button"
						class:warn={confirming === scene.id}
						onclick={() => load(scene.id)}
						onblur={() => confirming === scene.id && (confirming = null)}
					>
						{confirming === scene.id ? 'Replace table?' : 'Load'}
					</button>
					<button
						type="button"
						class="forget"
						class:warn={deleting === scene.id}
						aria-label={`Delete ${scene.name}`}
						title={deleting === scene.id ? 'Click again to delete for good' : 'Delete this save'}
						onclick={() => remove(scene)}
						onblur={() => deleting === scene.id && (deleting = null)}>×</button
					>
				</li>
			{/each}
		</ul>
	{/if}
	{#if older.length > 0}
		<p class="muted">Older saves in this browser</p>
		<ul class="saved" aria-label="Older saves in this browser">
			{#each older as scene (scene.sceneId)}
				<li>
					<span class="info">
						<span class="name">{scene.name}</span>
						<span class="when">{date.format(new Date(scene.savedAt))}</span>
					</span>
					<button
						type="button"
						class:warn={confirming === scene.sceneId}
						onclick={() => load(scene.sceneId)}
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
	{/if}

	<div class="files">
		<button type="button" onclick={exportFile}>Export file</button>
		<button type="button" onclick={() => fileInput.click()}>Import file</button>
		<button type="button" onclick={share}>Share table</button>
		<button type="button" aria-expanded={creating} onclick={() => (creating = !creating)}>
			New table
		</button>
		<input
			bind:this={fileInput}
			type="file"
			accept=".json,application/json"
			hidden
			onchange={importFile}
		/>
	</div>

	{#if shared}
		<div class="shared" role="status">
			<p class="muted">
				Anyone with this link opens a copy of “{shared.name}” (the table, not the story or who
				played whom):
			</p>
			<div class="row">
				<input
					readonly
					value={shared.link}
					aria-label="Shared table link"
					onfocus={(e) => e.currentTarget.select()}
				/>
				<button type="button" onclick={copyLink}>{copied ? 'Copied' : 'Copy'}</button>
			</div>
		</div>
	{/if}

	{#if creating}
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
					<option value="">Plain table</option>
					{#each environments as [id, envName] (id)}
						<option value={id}>{envName}</option>
					{/each}
				</select>
			</label>
			<p class="muted">An empty table replaces this one (save first to keep it).</p>
			<button class="primary" type="submit">Create table</button>
		</form>
	{/if}

	<form class="open" onsubmit={openShared}>
		<input
			bind:value={openCode}
			placeholder="Shared table link or code"
			aria-label="Shared table link or code"
		/>
		<button type="submit">Open</button>
	</form>
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

	.auto {
		color: var(--muted);
		font-size: 0.72rem;
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

	.shared .row,
	.open {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 0.3rem;
		margin-top: 0.4rem;
	}

	.open {
		margin-top: 0.6rem;
	}

	.shared input,
	.open input {
		min-width: 0;
		font-size: 0.8rem;
	}

	.new {
		display: grid;
		gap: 0.4rem;
		margin-top: 0.6rem;
		padding: 0.5rem;
		border: 1px solid var(--border);
		border-radius: 6px;
	}

	.new label {
		display: grid;
		gap: 0.15rem;
	}

	.new .muted {
		margin: 0;
	}

	.size {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.4rem;
	}

	.size input {
		min-width: 0;
	}
</style>
