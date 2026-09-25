<script lang="ts">
	import type { DraftWhen as When } from './draft';
	import ListInput from './ListInput.svelte';

	/**
	 * Conditions: every one filled in must hold. Lists are written with commas.
	 * An empty set of conditions always holds (and is left out of the file).
	 */
	let { when = $bindable() }: { when: When | undefined } = $props();

	const w = $derived(when ?? {});

	function set<K extends keyof When>(key: K, value: When[K] | undefined) {
		const next: When = { ...w };
		if (value === undefined || (Array.isArray(value) && value.length === 0)) delete next[key];
		else next[key] = value;
		when = Object.keys(next).length ? next : undefined;
	}

	const chose = $derived(
		Object.entries(w.chose ?? {})
			.map(([d, o]) => `${d}=${o}`)
			.join(', ')
	);
</script>

<div class="when">
	<label>
		<span>After events</span>
		<ListInput
			label="Events that have happened"
			options="ids-events"
			bind:value={() => w.events, (v) => set('events', v)}
			placeholder="event, event"
		/>
	</label>
	<label>
		<span>Not after</span>
		<ListInput
			label="Events that have not happened"
			options="ids-events"
			bind:value={() => w.not, (v) => set('not', v)}
		/>
	</label>
	<label>
		<span>Party found</span>
		<ListInput
			label="Clues someone found"
			options="ids-clues"
			bind:value={() => w.found, (v) => set('found', v)}
		/>
	</label>
	<label>
		<span>Nobody found</span>
		<ListInput
			label="Clues nobody found"
			options="ids-clues"
			bind:value={() => w.unfound, (v) => set('unfound', v)}
		/>
	</label>
	<label>
		<span>This character knows</span>
		<ListInput
			label="Clues the character acting knows"
			options="ids-clues"
			bind:value={() => w.clues, (v) => set('clues', v)}
		/>
	</label>
	<label>
		<span>In state</span>
		<ListInput
			label="The speaker's or object's state"
			bind:value={() => w.state, (v) => set('state', v)}
			placeholder="e.g. worried"
		/>
	</label>
	<label>
		<span>In chapter</span>
		<ListInput
			label="Chapters"
			options="ids-chapters"
			bind:value={() => w.chapter, (v) => set('chapter', v)}
		/>
	</label>
	<label>
		<span>Chose</span>
		<input
			aria-label="Choices made (choice=answer)"
			placeholder="choice=answer"
			value={chose}
			onchange={(e) => {
				const pairs = e.currentTarget.value
					.split(',')
					.map((p) => p.split('=').map((s) => s.trim()))
					.filter(([d, o]) => d && o);
				set('chose', pairs.length ? Object.fromEntries(pairs) : undefined);
			}}
		/>
	</label>
</div>

<style>
	.when {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr));
		gap: var(--sp-3) var(--sp-4);
	}

	label {
		display: grid;
		gap: var(--sp-1);
		font-size: var(--fs-xs);
		color: var(--muted);
	}
</style>
