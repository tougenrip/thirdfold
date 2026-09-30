<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { loadManifest } from '$lib/assets/load';
	import { DEFAULT_SKY, type Manifest } from '$lib/assets/manifest';
	import { AMBIENTS, type Ambient } from '$lib/game/lights';
	import { bandOf, MAX_EXPOSURE, WEATHERS, type WorldLook, type WorldPatch } from '$lib/game/world';
	import type { RoomAction } from '$lib/net/room-connection.svelte';

	/**
	 * The GM's clock: the hour on a slider (sent once, on release), four quick
	 * picks, the band it sets in words, the sun switch, and the atmosphere: the
	 * sky, haze and exposure (#224). Grade and weather stay disabled until drawn.
	 */
	interface Props {
		world: WorldLook;
		ambient: Ambient;
		/** The table's environment id, for the sky it falls back to. */
		environment: string | null;
		send(action: RoomAction): boolean;
	}

	let { world, ambient, environment, send }: Props = $props();

	let manifest = $state<Pick<Manifest, 'skies' | 'environments'>>({ skies: {}, environments: {} });
	onMount(() => void loadManifest().then((m) => (manifest = m)));
	const skies = $derived(Object.entries(manifest.skies).map(([id, s]) => [id, s.name] as const));
	// resolveSky's open-sky order (the look's, the place's, the default), inlined:
	// importing it would pull it into the manifest parser's chunk on every page.
	const enclosed = $derived.by(() => {
		const { skies, environments } = manifest;
		const env =
			environment && Object.hasOwn(environments, environment) ? environments[environment] : null;
		const id = [world.sky, env?.sky, DEFAULT_SKY].find((s) => s && Object.hasOwn(skies, s));
		return !!id && skies[id].kind === 'enclosed';
	});

	const LAST = 1435;
	const PICKS = [
		{ label: 'Dawn', time: 360 },
		{ label: 'Noon', time: 720 },
		{ label: 'Dusk', time: 1170 },
		{ label: 'Night', time: 1380 }
	];
	const BAND: Record<Ambient, { name: string; rule: string }> = {
		day: { name: 'Day', rule: 'everyone sees as far as they can.' },
		dusk: { name: 'Dusk', rule: 'the light fades; sight is as by day.' },
		dark: { name: 'Night', rule: 'only light lets anyone see.' }
	};

	/** The hour while the GM drags, before it is sent; forgotten when the world changes. */
	let draft = $state<number | null>(null);
	$effect(() => {
		void world;
		draft = null;
	});

	const shown = $derived(draft ?? world.time);
	const band = $derived(world.sun ? bandOf(shown) : ambient);
	const clock = (t: number) =>
		`${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;

	function setTime(time: number) {
		draft = time;
		if (time !== world.time) send({ type: 'world_set', patch: { time } });
	}

	// The atmosphere's sliders: shown as dragged, sent at most every THROTTLE_MS
	// while dragging and once on release, never a value the world already has.
	const THROTTLE_MS = 250;
	type Knob = 'density' | 'color' | 'exposure';
	type Value = number | string | null;
	const PATCH: Record<Knob, (v: Value) => WorldPatch> = {
		density: (v) => ({ haze: { density: v as number } }),
		color: (v) => ({ haze: { color: v as string | null } }),
		exposure: (v) => ({ grade: { exposure: v as number } })
	};
	const current = (k: Knob): Value =>
		k === 'density' ? world.haze.density : k === 'color' ? world.haze.color : world.grade.exposure;

	let drafts = $state<Partial<Record<Knob, Value>>>({});
	let dragging: Knob | null = null;
	const sent: Partial<Record<Knob, Value>> = {};
	const timers: Partial<Record<Knob, ReturnType<typeof setTimeout>>> = {};
	$effect(() => {
		void world;
		untrack(() => {
			for (const k of Object.keys(drafts) as Knob[]) if (k !== dragging) delete drafts[k];
			for (const k of Object.keys(sent) as Knob[]) delete sent[k];
		});
	});
	$effect(() => () => Object.values(timers).forEach(clearTimeout));

	const shownOf = (k: Knob): Value => (k in drafts ? (drafts[k] as Value) : current(k));

	function push(k: Knob, v: Value) {
		if (v === (k in sent ? sent[k] : current(k))) return;
		sent[k] = v;
		send({ type: 'world_set', patch: PATCH[k](v) });
	}

	function drag(k: Knob, v: Value) {
		dragging = k;
		drafts[k] = v;
		timers[k] ??= setTimeout(() => {
			delete timers[k];
			push(k, drafts[k] as Value);
		}, THROTTLE_MS);
	}

	function release(k: Knob, v: Value) {
		clearTimeout(timers[k]);
		delete timers[k];
		if (dragging === k) dragging = null;
		drafts[k] = v;
		push(k, v);
	}

	const density = $derived(shownOf('density') as number);
	const exposure = $derived(shownOf('exposure') as number);
	const hazeColor = $derived(shownOf('color') as string | null);
	const ev = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v)} EV`;

	// Browsers differ on a range's page step: here PageUp and PageDown move an hour.
	function onKey(e: KeyboardEvent) {
		if (e.key !== 'PageUp' && e.key !== 'PageDown') return;
		e.preventDefault();
		setTime(Math.min(LAST, Math.max(0, shown + (e.key === 'PageUp' ? 60 : -60))));
	}
</script>

<div class="time">
	{#if world.sun}
		<div class="clock">
			<span aria-hidden="true">Time of day</span>
			<output class="num" aria-hidden="true">{clock(shown)}</output>
			<input
				type="range"
				aria-label="Time of day"
				min="0"
				max={LAST}
				step="5"
				value={shown}
				aria-valuetext={`${clock(shown)}, ${BAND[band].name.toLowerCase()}`}
				oninput={(e) => (draft = e.currentTarget.valueAsNumber)}
				onchange={(e) => setTime(e.currentTarget.valueAsNumber)}
				onkeydown={onKey}
			/>
		</div>
		<div class="picks four" role="radiogroup" aria-label="Quick times">
			{#each PICKS as p (p.time)}
				<button
					type="button"
					role="radio"
					aria-checked={shown === p.time}
					title={clock(p.time)}
					onclick={() => setTime(p.time)}>{p.label}</button
				>
			{/each}
		</div>
	{:else}
		<div class="picks three" role="radiogroup" aria-label="Light">
			{#each AMBIENTS as a (a)}
				<button
					type="button"
					role="radio"
					aria-checked={ambient === a}
					onclick={() => send({ type: 'ambient_set', ambient: a })}>{BAND[a].name}</button
				>
			{/each}
		</div>
		<p class="note">Underground: the hour doesn't change the light here.</p>
	{/if}
	<p class="band"><strong>{BAND[band].name}:</strong> {BAND[band].rule}</p>
	<label class="check">
		<input
			type="checkbox"
			checked={!world.sun}
			onchange={(e) => send({ type: 'world_set', patch: { sun: !e.currentTarget.checked } })}
		/>
		Underground (no sun)
	</label>
	{#if world.sun && enclosed}
		<p class="note">No sky here: the hour doesn't change the look.</p>
	{/if}
	<details>
		<summary>Atmosphere</summary>
		<div class="grid">
			<label class="wide">
				<span class="note">Sky</span>
				<select
					value={world.sky ?? ''}
					onchange={(e) => {
						const sky = e.currentTarget.value || null;
						if (sky !== world.sky) send({ type: 'world_set', patch: { sky } });
					}}
				>
					<option value="">The place's own</option>
					{#each skies as [id, name] (id)}<option value={id}>{name}</option>{/each}
				</select>
			</label>
			<label>
				<span class="note">Haze</span>
				<input
					type="range"
					min="0"
					max="1"
					step="0.05"
					value={density}
					aria-valuetext={`Haze ${Math.round(density * 100)}%`}
					oninput={(e) => drag('density', e.currentTarget.valueAsNumber)}
					onchange={(e) => release('density', e.currentTarget.valueAsNumber)}
				/>
			</label>
			<label>
				<span class="note">Exposure</span>
				<input
					type="range"
					min={-MAX_EXPOSURE}
					max={MAX_EXPOSURE}
					step="0.25"
					value={exposure}
					aria-valuetext={ev(exposure)}
					oninput={(e) => drag('exposure', e.currentTarget.valueAsNumber)}
					onchange={(e) => release('exposure', e.currentTarget.valueAsNumber)}
				/>
			</label>
			<label>
				<span class="note">Haze colour</span>
				<input
					type="color"
					value={hazeColor ?? '#9aa4b2'}
					oninput={(e) => drag('color', e.currentTarget.value)}
					onchange={(e) => release('color', e.currentTarget.value)}
				/>
			</label>
			<div class="resets">
				<button type="button" disabled={hazeColor === null} onclick={() => release('color', null)}
					>Sky's haze</button
				>
				<button type="button" disabled={exposure === 0} onclick={() => release('exposure', 0)}
					>Exposure 0</button
				>
			</div>
		</div>
		<fieldset class="grid" disabled title="Not drawn yet">
			<legend class="note">Not drawn yet</legend>
			<label>
				<span class="note">Weather</span>
				<select value={world.weather.kind}>
					{#each WEATHERS as w (w)}<option value={w}>{w === 'none' ? 'Clear' : w}</option>{/each}
				</select>
			</label>
			<label>
				<span class="note">Weather strength</span>
				<input type="range" min="0" max="1" step="0.1" value={world.weather.intensity} />
			</label>
			<label class="wide">
				<span class="note">Grade</span>
				<select value={world.grade.preset ?? ''}><option value="">The place's own</option></select>
			</label>
		</fieldset>
	</details>
</div>

<style>
	.time {
		display: grid;
		gap: var(--sp-3);
	}

	.clock {
		display: grid;
		grid-template-columns: 1fr auto;
		align-items: baseline;
		gap: var(--sp-2) var(--sp-3);
		font-size: var(--fs-sm);
	}

	.clock output {
		font-size: var(--fs-md);
		color: var(--accent);
	}

	.clock input {
		grid-column: 1 / -1;
		width: 100%;
		accent-color: var(--accent);
	}

	.picks {
		display: grid;
		gap: var(--sp-3);
	}

	.four {
		grid-template-columns: repeat(4, 1fr);
	}

	.three {
		grid-template-columns: repeat(3, 1fr);
	}

	.picks button {
		padding: var(--sp-3) var(--sp-2);
		font-size: var(--fs-xs);
	}

	.picks [aria-checked='true'] {
		border-color: var(--accent);
		background: var(--accent-wash);
		color: var(--accent);
	}

	.band,
	.note {
		margin: 0;
		font-size: var(--fs-xs);
		color: var(--muted);
	}

	.band strong {
		color: var(--text);
		font-weight: 600;
	}

	.check {
		display: flex;
		align-items: center;
		gap: var(--sp-3);
		font-size: var(--fs-xs);
	}

	.check input {
		accent-color: var(--accent);
	}

	summary {
		cursor: pointer;
		font-size: var(--fs-xs);
	}

	.grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--sp-3);
		margin: var(--sp-3) 0 0;
		padding: 0;
		border: 0;
	}

	fieldset {
		opacity: 0.6;
	}

	legend {
		padding: 0;
		margin-bottom: var(--sp-2);
	}

	.grid label {
		display: grid;
		gap: var(--sp-1);
		min-width: 0;
	}

	.wide {
		grid-column: 1 / -1;
	}

	.grid select,
	.grid input {
		width: 100%;
		min-width: 0;
		font-size: var(--fs-xs);
		accent-color: var(--accent);
	}

	.resets {
		display: grid;
		gap: var(--sp-2);
		align-content: end;
	}

	.resets button {
		padding: var(--sp-2);
		font-size: var(--fs-xs);
	}

	option {
		text-transform: capitalize;
	}
</style>
