<script lang="ts">
	import { AMBIENTS, type Ambient } from '$lib/game/lights';
	import { bandOf, WEATHERS, type WorldLook } from '$lib/game/world';
	import type { RoomAction } from '$lib/net/room-connection.svelte';

	/**
	 * The GM's clock: the hour on a slider (sent once, on release), four quick
	 * picks, the band it sets in words, the sun switch, and the atmosphere
	 * controls, which stay disabled until the renderer draws them.
	 */
	interface Props {
		world: WorldLook;
		ambient: Ambient;
		send(action: RoomAction): boolean;
	}

	let { world, ambient, send }: Props = $props();

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
	<details>
		<summary>Atmosphere <span class="note">(not drawn yet)</span></summary>
		<fieldset disabled title="Not drawn yet">
			<label>
				<span class="note">Sky</span>
				<select value={world.sky ?? ''}><option value="">The place's own</option></select>
			</label>
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
			<label>
				<span class="note">Haze</span>
				<input type="range" min="0" max="1" step="0.1" value={world.haze.density} />
			</label>
			<label>
				<span class="note">Grade</span>
				<select value={world.grade.preset ?? ''}><option value="">The place's own</option></select>
			</label>
			<label>
				<span class="note">Exposure</span>
				<input type="range" min="-2" max="2" step="0.25" value={world.grade.exposure} />
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

	fieldset {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--sp-3);
		margin: var(--sp-3) 0 0;
		padding: 0;
		border: 0;
		opacity: 0.6;
	}

	fieldset label {
		display: grid;
		gap: var(--sp-1);
		min-width: 0;
	}

	fieldset select,
	fieldset input {
		width: 100%;
		min-width: 0;
		font-size: var(--fs-xs);
	}

	option {
		text-transform: capitalize;
	}
</style>
