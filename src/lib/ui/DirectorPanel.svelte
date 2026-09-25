<script lang="ts">
	import type { AdventureView } from '$lib/adventure/adventure';
	import { parseDice } from '$lib/game/dice';
	import { AMBIENTS, type Ambient, type Light } from '$lib/game/lights';
	import type { Direction } from '$lib/game/protocol';
	import type { RoomAction } from '$lib/net/room-connection.svelte';
	import type { BuildTool } from './BuildPanel.svelte';

	/**
	 * The GM's controls for running the story as it is played: pause, skip
	 * ahead, fights, enemies, people, story events, the environment, what the
	 * players see, and dice. Everything here directs; nothing builds.
	 */
	interface Props {
		adventure: AdventureView;
		paused: boolean;
		ambient: Ambient;
		lights: Light[];
		fogEnabled: boolean;
		fogShared: boolean;
		tool: BuildTool;
		/** The enemy kind the GM is placing, if any. */
		spawning: string | null;
		send(action: RoomAction): boolean;
		onTool(tool: BuildTool): void;
		onSpawn(kind: string | null): void;
		onSelectToken(tokenId: string): void;
		onFogAll(reveal: boolean): void;
		onError(message: string): void;
	}

	let {
		adventure,
		paused,
		ambient,
		lights,
		fogEnabled,
		fogShared,
		tool,
		spawning,
		send,
		onTool,
		onSpawn,
		onSelectToken,
		onFogAll,
		onError
	}: Props = $props();

	const director = $derived(adventure.director);
	const playing = $derived(adventure.stage === 'playing');
	const encounter = $derived(adventure.encounter);

	let eventId = $state('');
	let encounterId = $state('');
	let enemyKind = $state('');
	let dice = $state('1d20');

	const AMBIENT_LABEL: Record<Ambient, string> = { day: 'Day', dusk: 'Dusk', dark: 'Dark' };
	const VIEW_TOOLS: { tool: BuildTool; label: string }[] = [
		{ tool: 'reveal', label: 'Reveal area' },
		{ tool: 'hide', label: 'Hide area' },
		{ tool: 'reveal-room', label: 'Reveal room' },
		{ tool: 'hide-room', label: 'Hide room' }
	];

	// Keep the pickers on something that is still offered.
	$effect(() => {
		const events = director?.events ?? [];
		if (!events.some((e) => e.id === eventId)) eventId = events[0]?.id ?? '';
		const fights = director?.encounters ?? [];
		if (!fights.some((e) => e.id === encounterId)) encounterId = fights[0]?.id ?? '';
		const kinds = director?.enemies ?? [];
		if (!kinds.some((e) => e.kind === enemyKind)) enemyKind = kinds[0]?.kind ?? '';
	});

	const direct = (direction: Direction) => send({ type: 'adventure_direct', direction });

	function roll(secret: boolean) {
		const parsed = parseDice(dice);
		if (!parsed.ok) return onError(parsed.error);
		send(
			secret
				? { type: 'dice_roll', expression: dice, secret: true }
				: { type: 'dice_roll', expression: dice }
		);
	}

	const lightName = (l: Light) => `Light at ${l.pos.x + 1}, ${l.pos.y + 1}`;
	const fightState = (state: string | null) =>
		state === 'won' ? ' (won)' : state === 'lost' ? ' (lost)' : state === 'active' ? ' (on)' : '';
</script>

<h2 class="section-title">Direct</h2>

<div class="section">
	<div class="row">
		<button
			type="button"
			aria-pressed={paused}
			onclick={() => send({ type: 'pause_set', paused: !paused })}
		>
			{paused ? 'Carry on' : 'Pause game'}
		</button>
		<button
			type="button"
			disabled={!playing || !director?.skip}
			title={director?.skip ? `Skip to: ${director.skip}` : 'Nothing to skip to now'}
			onclick={() => direct({ op: 'skip' })}
		>
			Skip scene
		</button>
	</div>
	{#if director?.skip && playing}
		<p class="note">Next: {director.skip}</p>
	{:else if adventure.decision}
		<p class="note">Waiting on the party’s choice.</p>
	{/if}
</div>

{#if director && playing}
	<div class="section">
		<h3 class="section-title">Fight</h3>
		{#if encounter}
			<p class="note num">Round {encounter.round} is on.</p>
			<div class="row">
				<button type="button" onclick={() => direct({ op: 'encounter_end', result: 'won' })}>
					End: party wins
				</button>
				<button type="button" onclick={() => direct({ op: 'encounter_end', result: 'called_off' })}>
					Call it off
				</button>
			</div>
		{:else}
			<label>
				<span class="visually-hidden">Fight to start</span>
				<select bind:value={encounterId}>
					{#each director.encounters as e (e.id)}
						<option value={e.id}>{e.name}{fightState(e.state)}</option>
					{/each}
				</select>
			</label>
			<button
				type="button"
				disabled={!encounterId}
				onclick={() => direct({ op: 'encounter_start', encounter: encounterId })}
			>
				Start fight
			</button>
		{/if}
	</div>

	<div class="section">
		<h3 class="section-title">Enemies</h3>
		<div class="row pick">
			<label>
				<span class="visually-hidden">Enemy to bring on</span>
				<select bind:value={enemyKind}>
					{#each director.enemies as e (e.kind)}
						<option value={e.kind}>{e.name}</option>
					{/each}
				</select>
			</label>
			<button
				type="button"
				aria-pressed={spawning !== null}
				onclick={() => onSpawn(spawning ? null : enemyKind)}
			>
				{spawning ? 'Cancel' : 'Place'}
			</button>
		</div>
		{#if director.foes.length}
			<ul class="list">
				{#each director.foes as f (f.tokenId)}
					<li>
						<button type="button" class="ghost link" onclick={() => onSelectToken(f.tokenId)}>
							{f.name}
						</button>
						<span class="muted num">{f.hp === null ? 'on watch' : `${f.hp}/${f.maxHp} HP`}</span>
						<button
							type="button"
							class="small danger"
							onclick={() => send({ type: 'token_delete', tokenId: f.tokenId })}
						>
							Remove
						</button>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="note">No enemies on the table.</p>
		{/if}
	</div>

	{#if director.people.length}
		<div class="section">
			<h3 class="section-title">People here</h3>
			<p class="note">Pick someone, then click a cell to move them.</p>
			<ul class="chips">
				{#each director.people as p (p.tokenId)}
					<li>
						<button type="button" class="small" onclick={() => onSelectToken(p.tokenId)}>
							{p.name}
						</button>
					</li>
				{/each}
			</ul>
		</div>
	{/if}

	<div class="section">
		<h3 class="section-title">Story</h3>
		<label>
			<span class="visually-hidden">Event to trigger</span>
			<select bind:value={eventId} disabled={director.events.length === 0}>
				{#each director.events as e (e.id)}
					<option value={e.id}>{e.label}</option>
				{/each}
			</select>
		</label>
		<button
			type="button"
			disabled={!eventId}
			onclick={() => direct({ op: 'event', event: eventId })}
		>
			Make it happen
		</button>
	</div>
{/if}

<div class="section">
	<h3 class="section-title">Environment</h3>
	<div class="row three" role="radiogroup" aria-label="Time of day">
		{#each AMBIENTS as a (a)}
			<button
				type="button"
				role="radio"
				aria-checked={ambient === a}
				onclick={() => send({ type: 'ambient_set', ambient: a })}
			>
				{AMBIENT_LABEL[a]}
			</button>
		{/each}
	</div>
	{#if lights.length}
		<details>
			<summary>Lights ({lights.filter((l) => l.on).length} of {lights.length} on)</summary>
			<ul class="list">
				{#each lights as l (l.id)}
					<li>
						<span class="swatch" style:background={l.color}></span>
						<span>{lightName(l)}</span>
						<button
							type="button"
							class="small"
							aria-pressed={l.on}
							onclick={() => send({ type: 'light_update', lightId: l.id, patch: { on: !l.on } })}
						>
							{l.on ? 'On' : 'Off'}
						</button>
					</li>
				{/each}
			</ul>
		</details>
	{/if}
</div>

<div class="section">
	<h3 class="section-title">What players see</h3>
	{#if fogEnabled}
		<div class="row">
			{#each VIEW_TOOLS as t (t.tool)}
				<button
					type="button"
					aria-pressed={tool === t.tool}
					onclick={() => onTool(tool === t.tool ? 'select' : t.tool)}
				>
					{t.label}
				</button>
			{/each}
			<button type="button" onclick={() => onFogAll(true)}>Reveal all</button>
			<button type="button" onclick={() => onFogAll(false)}>Hide all</button>
		</div>
		<label class="check">
			<input
				type="checkbox"
				checked={fogShared}
				onchange={(e) => send({ type: 'fog_share', shared: e.currentTarget.checked })}
			/>
			The party shares its sight
		</label>
	{:else}
		<p class="note">Fog is off: players see the whole table.</p>
	{/if}
</div>

<div class="section">
	<h3 class="section-title">Dice</h3>
	<div class="row dice">
		<label>
			<span class="visually-hidden">Dice to roll</span>
			<input bind:value={dice} maxlength="40" spellcheck="false" />
		</label>
		<button type="button" onclick={() => roll(false)}>Roll</button>
		<button type="button" title="Only you see the result" onclick={() => roll(true)}>
			Secret
		</button>
	</div>
</div>

<style>
	h2 {
		margin: 0 0 var(--sp-4);
	}

	.section {
		display: grid;
		gap: var(--sp-3);
		margin-top: var(--sp-4);
	}

	.section:first-of-type {
		margin-top: 0;
	}

	.row {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: var(--sp-3);
	}

	.row.three {
		grid-template-columns: repeat(3, 1fr);
	}

	.row.pick {
		grid-template-columns: 1fr auto;
	}

	.row.dice {
		grid-template-columns: 1fr auto auto;
	}

	button {
		padding: var(--sp-3) var(--sp-3);
		font-size: var(--fs-sm);
	}

	button[aria-checked='true'] {
		border-color: var(--accent);
		background: var(--accent-wash);
		color: var(--accent);
	}

	select,
	input:not([type='checkbox']) {
		width: 100%;
		min-width: 0;
		font-size: var(--fs-sm);
	}

	.note {
		margin: 0;
		font-size: var(--fs-xs);
		color: var(--muted);
	}

	.list {
		display: grid;
		gap: var(--sp-2);
		margin: 0;
		padding: 0;
		list-style: none;
		font-size: var(--fs-xs);
	}

	.list li {
		display: grid;
		grid-template-columns: auto 1fr auto;
		align-items: center;
		gap: var(--sp-3);
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: var(--sp-2);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.small {
		padding: var(--sp-1) var(--sp-3);
		font-size: var(--fs-xs);
	}

	.link {
		padding: 0;
		text-align: left;
		text-decoration: underline;
		color: inherit;
	}

	.muted {
		color: var(--muted);
		font-size: var(--fs-xs);
	}

	.swatch {
		width: 0.7rem;
		height: 0.7rem;
		border-radius: 50%;
	}

	.check {
		display: flex;
		align-items: center;
		gap: var(--sp-3);
		font-size: var(--fs-xs);
	}

	summary {
		cursor: pointer;
		font-size: var(--fs-xs);
	}
</style>
