<script lang="ts" module>
	import { without, type DraftEffect as Effect } from './draft';

	/** The effects the builder offers by name, with what a new one starts as. */
	const KINDS: { kind: string; label: string; make: () => Effect }[] = [
		{ kind: 'say', label: 'Say', make: () => ({ say: '' }) },
		{ kind: 'clue', label: 'Find a clue', make: () => ({ clue: '' }) },
		{ kind: 'tell', label: 'Tell the party a clue', make: () => ({ tell: '' }) },
		{ kind: 'event', label: 'Make an event happen', make: () => ({ event: '' }) },
		{ kind: 'reward', label: 'Give a reward', make: () => ({ reward: '' }) },
		{ kind: 'set', label: 'Set an object’s state', make: () => ({ set: '', to: 'opened' }) },
		{ kind: 'npc', label: 'Change someone’s state', make: () => ({ npc: '', becomes: '' }) },
		{ kind: 'offer', label: 'Offer a choice', make: () => ({ offer: '' }) },
		{ kind: 'fight', label: 'Start a fight', make: () => ({ fight: '' }) },
		{ kind: 'enter', label: 'Go to a chapter', make: () => ({ enter: '' }) },
		{ kind: 'heal', label: 'Heal the party', make: () => ({ heal: 2 }) },
		{ kind: 'ambient', label: 'Time of day', make: () => ({ ambient: 'dusk' }) },
		{ kind: 'reveal', label: 'Reveal the whole table', make: () => ({ reveal: 'all' }) },
		{ kind: 'settle', label: 'People go to their places', make: () => ({ settle: true }) },
		{ kind: 'remember', label: 'Remember a moment', make: () => ({ remember: '' }) },
		{ kind: 'rules', label: 'If… (the first that holds)', make: () => ({ rules: [{ do: [] }] }) }
	];
</script>

<script lang="ts">
	import { OBJECT_STATES } from '$lib/adventure/adventure';
	import { effectKind } from '$lib/adventure/file';
	import { AMBIENTS } from '$lib/game/lights';
	import RulesEditor from './RulesEditor.svelte';

	/**
	 * A list of effects, in order: what happens. Kinds the builder has no form
	 * for (from a hand-written file) are shown and edited as JSON.
	 */
	let { effects = $bindable(), label = 'Effects' }: { effects: Effect[]; label?: string } =
		$props();

	let adding = $state('say');

	function replace(i: number, next: Effect) {
		effects = effects.map((e, j) => (j === i ? next : e));
	}
	const patch = (i: number, fields: Record<string, unknown>) =>
		replace(i, { ...effects[i], ...fields } as Effect);
	const remove = (i: number) => (effects = effects.filter((_, j) => j !== i));
	const move = (i: number, by: number) => {
		const next = [...effects];
		const [e] = next.splice(i, 1);
		next.splice(Math.max(0, Math.min(next.length, i + by)), 0, e);
		effects = next;
	};
	const known = (e: Effect) => KINDS.some((k) => k.kind === effectKind(e));
	const field = (e: Effect, key: string) => String((e as Record<string, unknown>)[key] ?? '');
	let jsonError = $state<number | null>(null);
</script>

<div class="effects" role="group" aria-label={label}>
	{#each effects as e, i (i)}
		{@const kind = effectKind(e)}
		<div class="effect">
			<div class="head">
				<strong>{KINDS.find((k) => k.kind === kind)?.label ?? kind}</strong>
				<span class="tools">
					<button type="button" aria-label="Move up" disabled={i === 0} onclick={() => move(i, -1)}
						>↑</button
					>
					<button
						type="button"
						aria-label="Move down"
						disabled={i === effects.length - 1}
						onclick={() => move(i, 1)}>↓</button
					>
					<button type="button" aria-label="Remove" onclick={() => remove(i)}>×</button>
				</span>
			</div>
			{#if kind === 'say'}
				<textarea
					aria-label="Text"
					rows="2"
					value={field(e, 'say')}
					onchange={(ev) => patch(i, { say: ev.currentTarget.value })}></textarea>
				<div class="row">
					<input
						aria-label="Spoken by (blank: the narrator)"
						placeholder="Spoken by (blank: narrator)"
						value={field(e, 'speaker')}
						onchange={(ev) => {
							const rest = without(e as { speaker?: string }, 'speaker');
							const v = ev.currentTarget.value.trim();
							replace(i, (v ? { ...rest, speaker: v } : rest) as Effect);
						}}
					/>
					<label class="check">
						<input
							type="checkbox"
							checked={'private' in e}
							onchange={(ev) => {
								const rest = without(e as { private?: true }, 'private');
								replace(
									i,
									(ev.currentTarget.checked ? { ...rest, private: true } : rest) as Effect
								);
							}}
						/>
						Only to whoever did it
					</label>
				</div>
			{:else if kind === 'clue' || kind === 'tell'}
				<input
					aria-label="Clue"
					list="ids-clues"
					value={field(e, kind)}
					onchange={(ev) => patch(i, { [kind]: ev.currentTarget.value.trim() })}
				/>
			{:else if kind === 'event' || kind === 'offer' || kind === 'fight' || kind === 'enter'}
				<input
					aria-label={kind}
					list={{
						event: 'ids-events',
						offer: 'ids-decisions',
						fight: 'ids-encounters',
						enter: 'ids-chapters'
					}[kind]}
					value={field(e, kind)}
					onchange={(ev) => patch(i, { [kind]: ev.currentTarget.value.trim() })}
				/>
			{:else if kind === 'reward' || kind === 'remember'}
				<input
					aria-label={kind === 'reward' ? 'Reward' : 'Moment'}
					placeholder={kind === 'reward' ? 'e.g. The silver key' : 'e.g. rang_the_bell'}
					value={field(e, kind)}
					onchange={(ev) => patch(i, { [kind]: ev.currentTarget.value.trim() })}
				/>
			{:else if kind === 'set' && 'set' in e}
				<div class="row">
					<input
						aria-label="Object"
						list="ids-objects"
						value={e.set}
						onchange={(ev) => patch(i, { set: ev.currentTarget.value.trim() })}
					/>
					<select
						aria-label="To state"
						value={e.to}
						onchange={(ev) => patch(i, { to: ev.currentTarget.value })}
					>
						<option value="initial">its first state</option>
						{#each OBJECT_STATES as s (s)}<option value={s}>{s}</option>{/each}
					</select>
				</div>
			{:else if kind === 'npc' && 'npc' in e}
				<div class="row">
					<input
						aria-label="Person"
						list="ids-npcs"
						value={e.npc}
						onchange={(ev) => patch(i, { npc: ev.currentTarget.value.trim() })}
					/>
					<input
						aria-label="Becomes"
						placeholder="becomes (a state)"
						value={e.becomes}
						onchange={(ev) => patch(i, { becomes: ev.currentTarget.value.trim() })}
					/>
				</div>
			{:else if kind === 'heal' && 'heal' in e}
				<input
					type="number"
					min="1"
					max="100"
					aria-label="Hit points"
					value={e.heal}
					onchange={(ev) =>
						patch(i, { heal: Math.max(1, Math.round(ev.currentTarget.valueAsNumber) || 1) })}
				/>
			{:else if kind === 'ambient' && 'ambient' in e}
				<select
					aria-label="Time of day"
					value={e.ambient}
					onchange={(ev) => patch(i, { ambient: ev.currentTarget.value })}
				>
					{#each AMBIENTS as a (a)}<option value={a}>{a}</option>{/each}
				</select>
			{:else if kind === 'rules' && 'rules' in e}
				<RulesEditor bind:rules={() => [...e.rules], (rules) => replace(i, { rules })} />
			{:else if !known(e)}
				<textarea
					aria-label="Effect as JSON"
					class:invalid={jsonError === i}
					rows="3"
					value={JSON.stringify(e)}
					onchange={(ev) => {
						try {
							replace(i, JSON.parse(ev.currentTarget.value));
							jsonError = null;
						} catch {
							jsonError = i;
						}
					}}></textarea>
			{/if}
		</div>
	{/each}
	<div class="add">
		<select aria-label="Kind of effect to add" bind:value={adding}>
			{#each KINDS as k (k.kind)}<option value={k.kind}>{k.label}</option>{/each}
		</select>
		<button
			type="button"
			onclick={() => (effects = [...effects, KINDS.find((k) => k.kind === adding)!.make()])}
		>
			Add
		</button>
	</div>
</div>

<style>
	.effects {
		display: grid;
		gap: 0.35rem;
	}

	.effect {
		display: grid;
		gap: 0.25rem;
		padding: 0.35rem 0.45rem;
		border-left: 2px solid var(--accent);
		background: rgba(255, 255, 255, 0.03);
	}

	.head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		font-size: 0.8rem;
	}

	.tools button {
		padding: 0 0.35rem;
		font-size: 0.8rem;
	}

	.row,
	.add {
		display: flex;
		gap: 0.35rem;
		align-items: center;
		flex-wrap: wrap;
	}

	.row > input {
		flex: 1;
		min-width: 8rem;
	}

	.check {
		font-size: 0.8rem;
		color: var(--muted);
	}

	textarea {
		width: 100%;
		box-sizing: border-box;
		font: inherit;
	}

	.invalid {
		border-color: var(--danger);
	}
</style>
