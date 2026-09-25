<script lang="ts">
	import { NAME_MAX_LENGTH } from '$lib/game/protocol';

	/**
	 * Asks for the name someone plays under: before running an adventure
	 * (`running` is its title), or to change it. `onSave` gets the trimmed name.
	 */
	interface Props {
		running: string | null;
		onSave(name: string): void;
		onCancel(): void;
	}

	let { running, onSave, onCancel }: Props = $props();

	let dialog = $state<HTMLDialogElement | null>(null);
	let draft = $state('');

	export function open(initial: string) {
		draft = initial;
		dialog?.showModal();
	}

	function submit(event: SubmitEvent) {
		event.preventDefault();
		const name = draft.trim();
		if (!name) return;
		dialog?.close();
		onSave(name);
	}
</script>

<dialog bind:this={dialog} aria-labelledby="name-title" onclose={onCancel}>
	<form onsubmit={submit}>
		<h2 id="name-title">{running ? 'Your name at the table' : 'The name you play under'}</h2>
		<p>
			{running
				? `You’ll open a table for “${running}” as its GM. Your players will see this name.`
				: 'Players at your tables will see this name.'}
		</p>
		<!-- svelte-ignore a11y_autofocus -->
		<input
			bind:value={draft}
			maxlength={NAME_MAX_LENGTH}
			autocomplete="nickname"
			placeholder="e.g. Morgan"
			aria-label="Your name"
			autofocus
		/>
		<div class="actions">
			<button class="primary" type="submit" disabled={!draft.trim()}>
				{running ? 'Run it' : 'Save'}
			</button>
			<button type="button" class="ghost" onclick={() => dialog?.close()}>Cancel</button>
		</div>
	</form>
</dialog>

<style>
	dialog {
		width: min(26rem, calc(100% - 2rem));
		padding: var(--sp-7);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		background: var(--panel-solid);
		color: var(--text);
		box-shadow: var(--shadow-lg);
	}

	dialog::backdrop {
		background: var(--scrim);
	}

	form {
		display: grid;
		gap: var(--sp-5);
	}

	h2 {
		margin: 0;
		font-size: var(--fs-xl);
	}

	p {
		margin: 0;
		color: var(--muted);
	}

	.actions {
		display: flex;
		gap: var(--sp-4);
	}
</style>
