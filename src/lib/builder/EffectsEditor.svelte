<script lang="ts" module>
	import { ASSET_IDS } from '$lib/game/props';
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
		{ kind: 'rest', label: 'The party rests (by the rules)', make: () => ({ rest: 'short' }) },
		{
			kind: 'gear',
			label: 'Give gear (by the rules)',
			make: () => ({ gear: { item: 'srd-5.2.1:weapon:dagger', quantity: 1 } })
		},
		{ kind: 'ambient', label: 'Time of day', make: () => ({ ambient: 'dusk' }) },
		{ kind: 'world', label: 'Time, sky and weather', make: () => ({ world: { time: 1170 } }) },
		{ kind: 'light', label: 'A light changes', make: () => ({ light: '', on: true }) },
		{ kind: 'prop', label: 'A prop becomes', make: () => ({ prop: '', asset: ASSET_IDS[0] }) },
		{ kind: 'reveal', label: 'Reveal the whole map', make: () => ({ reveal: 'all' }) },
		{ kind: 'settle', label: 'People go to their places', make: () => ({ settle: true }) },
		{ kind: 'remember', label: 'Remember a moment', make: () => ({ remember: '' }) },
		{ kind: 'rules', label: 'If… (the first that holds)', make: () => ({ rules: [{ do: [] }] }) }
	];
</script>

<script lang="ts">
	import { OBJECT_STATES } from '$lib/adventure/adventure';
	import { effectKind } from '$lib/adventure/file';
	import { AMBIENTS, LIGHT_KINDS } from '$lib/game/lights';
	import { WEATHERS } from '$lib/game/world';
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
	/** Sets a field, or drops it when blank (a field left out is left as it is). */
	const opt = (i: number, key: string, value: unknown) => {
		const rest = without(effects[i] as Record<string, unknown>, key);
		replace(i, (value === undefined || value === '' ? rest : { ...rest, [key]: value }) as Effect);
	};
	/** Sets one field of the world patch (`group.key`, or a top-level key), dropping empty groups. */
	const worldField = (i: number, path: string, value: unknown) => {
		const world = structuredClone((effects[i] as { world: Record<string, unknown> }).world);
		const [a, b] = path.split('.');
		if (b === undefined) {
			if (value === undefined) delete world[a];
			else world[a] = value;
		} else {
			const group = { ...(world[a] as Record<string, unknown> | undefined) };
			if (value === undefined) delete group[b];
			else group[b] = value;
			if (Object.keys(group).length) world[a] = group;
			else delete world[a];
		}
		replace(i, { world } as Effect);
	};
	const clock = (t: unknown) =>
		typeof t === 'number'
			? `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
			: '';
	const minutes = (v: string) => {
		const [h, m] = v.split(':').map(Number);
		return v ? h * 60 + m : undefined;
	};
	const numberOr = (v: string) => (v.trim() === '' ? undefined : Number(v));
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
					<button
						type="button"
						class="ghost"
						aria-label="Move up"
						disabled={i === 0}
						onclick={() => move(i, -1)}>↑</button
					>
					<button
						type="button"
						class="ghost"
						aria-label="Move down"
						disabled={i === effects.length - 1}
						onclick={() => move(i, 1)}>↓</button
					>
					<button type="button" class="ghost" aria-label="Remove" onclick={() => remove(i)}
						>×</button
					>
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
			{:else if kind === 'rest' && 'rest' in e}
				<select
					aria-label="Rest"
					value={e.rest}
					onchange={(ev) => patch(i, { rest: ev.currentTarget.value as 'short' | 'long' })}
				>
					<option value="short">Short Rest (Hit Point Dice, some features)</option>
					<option value="long">Long Rest (everything back)</option>
				</select>
			{:else if kind === 'gear' && 'gear' in e}
				<div class="row">
					<input
						aria-label="Item"
						placeholder="srd-5.2.1:weapon:dagger"
						value={e.gear.item}
						onchange={(ev) =>
							patch(i, { gear: { ...e.gear, item: ev.currentTarget.value.trim() } })}
					/>
					<input
						type="number"
						min="1"
						max="99"
						aria-label="How many"
						value={e.gear.quantity}
						onchange={(ev) =>
							patch(i, {
								gear: {
									...e.gear,
									quantity: Math.max(1, Math.round(ev.currentTarget.valueAsNumber) || 1)
								}
							})}
					/>
					<label class="check">
						<input
							type="checkbox"
							checked={e.gear.to === 'party'}
							onchange={(ev) => {
								patch(i, {
									gear: ev.currentTarget.checked
										? { ...e.gear, to: 'party' }
										: { item: e.gear.item, quantity: e.gear.quantity }
								});
							}}
						/>
						Each of the party
					</label>
				</div>
			{:else if kind === 'ambient' && 'ambient' in e}
				<select
					aria-label="Time of day"
					value={e.ambient}
					onchange={(ev) => patch(i, { ambient: ev.currentTarget.value })}
				>
					{#each AMBIENTS as a (a)}<option value={a}>{a}</option>{/each}
				</select>
			{:else if kind === 'world' && 'world' in e}
				{@const w = e.world as Record<string, Record<string, unknown> | undefined>}
				<div class="row">
					<label class="check">
						Time
						<input
							type="time"
							value={clock(e.world.time)}
							onchange={(ev) => worldField(i, 'time', minutes(ev.currentTarget.value))}
						/>
					</label>
					<select
						aria-label="Weather"
						value={w.weather?.kind ?? ''}
						onchange={(ev) => worldField(i, 'weather.kind', ev.currentTarget.value || undefined)}
					>
						<option value="">weather as it is</option>
						{#each WEATHERS as k (k)}<option value={k}>{k}</option>{/each}
					</select>
					<input
						type="number"
						min="0"
						max="1"
						step="0.1"
						aria-label="Weather intensity"
						placeholder="intensity 0-1"
						value={w.weather?.intensity ?? ''}
						onchange={(ev) => worldField(i, 'weather.intensity', numberOr(ev.currentTarget.value))}
					/>
				</div>
				<div class="row">
					<select aria-label="Sky" disabled><option>the environment’s sky</option></select>
					<select aria-label="Grade" disabled><option>the environment’s grade</option></select>
					<input
						type="number"
						min="-2"
						max="2"
						step="0.25"
						aria-label="Exposure"
						placeholder="exposure, EV"
						value={w.grade?.exposure ?? ''}
						onchange={(ev) => worldField(i, 'grade.exposure', numberOr(ev.currentTarget.value))}
					/>
				</div>
			{:else if kind === 'light' && 'light' in e}
				<div class="row">
					<input
						aria-label="Light"
						list="ids-lights"
						value={e.light}
						onchange={(ev) => patch(i, { light: ev.currentTarget.value.trim() })}
					/>
					<select
						aria-label="On or off"
						value={e.on === undefined ? '' : String(e.on)}
						onchange={(ev) =>
							opt(i, 'on', ev.currentTarget.value ? ev.currentTarget.value === 'true' : '')}
					>
						<option value="">as it is</option>
						<option value="true">on</option>
						<option value="false">off</option>
					</select>
					<select
						aria-label="Kind of light"
						value={e.kind ?? ''}
						onchange={(ev) => opt(i, 'kind', ev.currentTarget.value)}
					>
						<option value="">kind as it is</option>
						{#each LIGHT_KINDS as k (k)}<option value={k}>{k}</option>{/each}
					</select>
				</div>
				<div class="row">
					<input
						aria-label="Colour"
						placeholder="colour, #rrggbb"
						value={e.color ?? ''}
						onchange={(ev) => opt(i, 'color', ev.currentTarget.value.trim())}
					/>
					<input
						type="number"
						min="0"
						max="20"
						aria-label="Reach in cells"
						placeholder="reach, cells"
						value={e.radius ?? ''}
						onchange={(ev) => opt(i, 'radius', numberOr(ev.currentTarget.value))}
					/>
				</div>
			{:else if kind === 'prop' && 'prop' in e && 'asset' in e}
				<div class="row">
					<input
						aria-label="Prop"
						list="ids-props"
						value={e.prop}
						onchange={(ev) => patch(i, { prop: ev.currentTarget.value.trim() })}
					/>
					<select
						aria-label="Becomes"
						value={e.asset}
						onchange={(ev) => patch(i, { asset: ev.currentTarget.value })}
					>
						{#each ASSET_IDS as a (a)}<option value={a}>{a}</option>{/each}
					</select>
				</div>
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
		gap: var(--sp-3);
	}

	.effect {
		display: grid;
		gap: var(--sp-2);
		padding: var(--sp-3) var(--sp-4);
		border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
		border-radius: var(--radius-sm);
		background: var(--accent-wash);
	}

	.head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		font-size: var(--fs-xs);
	}

	.tools button {
		padding: 0 var(--sp-3);
		font-size: var(--fs-xs);
	}

	.row,
	.add {
		display: flex;
		gap: var(--sp-3);
		align-items: center;
		flex-wrap: wrap;
	}

	.row > input {
		flex: 1;
		min-width: 8rem;
	}

	.check {
		font-size: var(--fs-xs);
		color: var(--muted);
	}

	textarea {
		width: 100%;
	}

	.invalid {
		border-color: var(--danger);
	}
</style>
