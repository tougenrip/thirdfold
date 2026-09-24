<script lang="ts">
	import {
		canReach,
		inActionRange,
		type AdventureView,
		type CharacterStatus
	} from '$lib/adventure/adventure';
	import {
		BLEED_OUT_ROUNDS,
		CHARACTERS,
		describeAction,
		STATUSES,
		type Action
	} from '$lib/adventure/characters';
	import type { Blockers } from '$lib/game/objects';
	import type { Token } from '$lib/game/token';
	import type { RoomAction } from '$lib/net/room-connection.svelte';

	interface Props {
		adventure: AdventureView;
		character: CharacterStatus;
		/** The character's token (always visible to its own player). */
		token: Token;
		tokens: readonly Token[];
		blocked: Blockers;
		/** The action waiting for a target, if one was picked. */
		targeting: string | null;
		onTargeting(actionId: string | null): void;
		onSheet(): void;
		send(action: RoomAction): boolean;
	}

	let {
		adventure,
		character,
		token,
		tokens,
		blocked,
		targeting,
		onTargeting,
		onSheet,
		send
	}: Props = $props();

	const def = $derived(CHARACTERS[character.id]);
	const encounter = $derived(adventure.encounter);
	const acted = $derived(!!encounter?.acted.includes(character.id));
	const able = $derived(!character.downed && !character.dead);
	const movesLeft = $derived(
		encounter ? Math.max(0, def.speed - (encounter.moved[character.id] ?? 0)) : null
	);
	const myTurn = $derived(!!encounter && encounter.phase === 'players' && !acted && able);
	const nearby = $derived(
		encounter || !able || adventure.stage === 'choosing'
			? []
			: adventure.interactables.filter((i) => canReach(blocked, token.pos, i.cells))
	);
	/** Actions that make sense now: everything in a fight, only healing outside one. */
	const actions = $derived(
		!able || adventure.stage === 'choosing'
			? []
			: def.actions.filter((a) => (encounter ? true : a.kind === 'heal'))
	);
	const chosen = $derived(actions.find((a) => a.id === targeting) ?? null);

	interface Target {
		tokenId: string;
		name: string;
		detail: string;
		inReach: boolean;
	}

	function targetsFor(action: Action): Target[] {
		const at = (id: string | null) => (id ? tokens.find((t) => t.id === id) : undefined);
		if (action.target === 'enemy') {
			return (encounter?.enemies ?? []).flatMap((e) => {
				const t = at(e.tokenId);
				if (!t) return [];
				const inReach = inActionRange(blocked, token.pos, t.pos, action);
				return [{ tokenId: t.id, name: e.name, detail: `${e.hp}/${e.maxHp}`, inReach }];
			});
		}
		return adventure.characters.flatMap((c) => {
			const t = at(c.tokenId);
			if (!t || c.dead) return [];
			const inReach = inActionRange(blocked, token.pos, t.pos, action);
			const detail = c.downed ? 'down' : `${c.hp}/${c.maxHp}`;
			return [{ tokenId: t.id, name: CHARACTERS[c.id].name, detail, inReach }];
		});
	}

	const canUse = (action: Action) =>
		(encounter ? myTurn : true) && character.usesLeft[action.id] !== 0;

	function pick(action: Action) {
		if (action.target === 'self') {
			send({ type: 'adventure_act', actionId: action.id, targetId: null });
			return onTargeting(null);
		}
		onTargeting(targeting === action.id ? null : action.id);
	}

	function use(action: Action, target: Target) {
		send({ type: 'adventure_act', actionId: action.id, targetId: target.tokenId });
		onTargeting(null);
	}

	const status = $derived.by(() => {
		if (character.dead) return `${def.name} is dead. The GM can bring them back.`;
		if (character.downed) {
			const left = BLEED_OUT_ROUNDS - character.downedFor;
			return `${def.name} is down: heal them within ${left} ${left === 1 ? 'round' : 'rounds'}.`;
		}
		if (adventure.stage === 'choosing') return 'Waiting for the GM to begin.';
		if (chosen) return `${chosen.name}: choose a target, here or on the table.`;
		if (!encounter) {
			return nearby.length
				? 'Something here you can use.'
				: 'Click a cell to walk there. Go up to people and things.';
		}
		if (encounter.phase === 'enemies') return "The enemies' turn…";
		if (acted) return 'Done for this round. Waiting for the others.';
		return `Your turn: ${movesLeft} ${movesLeft === 1 ? 'cell' : 'cells'} of movement, one action.`;
	});
	const hpPercent = $derived(Math.round((100 * character.hp) / character.maxHp));
</script>

<section class="bar" class:down={!able} aria-label="Your character" style:--char={def.color}>
	<div class="who">
		<button type="button" class="name" onclick={onSheet} title="Character sheet">{def.name}</button>
		<span
			class="hp"
			role="meter"
			aria-label="Hit points"
			aria-valuenow={character.hp}
			aria-valuemin="0"
			aria-valuemax={character.maxHp}
		>
			<span class="fill" style:width={`${hpPercent}%`}></span>
			<span class="label">{character.hp}/{character.maxHp} HP</span>
		</span>
		{#each character.statuses as s (s.id)}
			<span class="chip" title={STATUSES[s.id].about}>{STATUSES[s.id].name}</span>
		{/each}
	</div>
	<p class="status" aria-live="polite">{status}</p>

	{#if chosen}
		<div class="actions" aria-label={`Targets for ${chosen.name}`}>
			{#each targetsFor(chosen) as t (t.tokenId)}
				<button
					type="button"
					class="primary"
					disabled={!t.inReach}
					title={t.inReach ? '' : 'Out of reach'}
					onclick={() => use(chosen, t)}
				>
					{t.name} <small>{t.detail}</small>
				</button>
			{/each}
			<button type="button" onclick={() => onTargeting(null)}>Cancel</button>
		</div>
	{:else}
		<div class="actions">
			{#if adventure.stage === 'choosing'}
				<button type="button" onclick={() => send({ type: 'adventure_release' })}>
					Choose another
				</button>
			{/if}
			{#each nearby as i (i.id)}
				<button
					type="button"
					class="primary"
					onclick={() => send({ type: 'adventure_interact', targetId: i.id })}
				>
					{i.label}
				</button>
			{/each}
			{#each actions as action (action.id)}
				{@const left = character.usesLeft[action.id]}
				<button
					type="button"
					class="action"
					disabled={!canUse(action)}
					title={`${describeAction(def, action)}. ${action.about}`}
					onclick={() => pick(action)}
				>
					{action.name}
					{#if left !== null && left !== undefined}<small>{left} left</small>{/if}
				</button>
			{/each}
			{#if encounter && able}
				<button
					type="button"
					disabled={!myTurn}
					onclick={() => send({ type: 'adventure_end_turn' })}
				>
					End turn
				</button>
			{/if}
		</div>
	{/if}
</section>

<style>
	.bar {
		display: grid;
		gap: 0.4rem;
		padding: 0.6rem 0.75rem;
		background: var(--panel);
		border: 1px solid var(--border);
		border-left: 4px solid var(--char);
		border-radius: 10px;
		backdrop-filter: blur(6px);
		min-width: min(26rem, 100%);
	}

	.bar.down {
		border-color: var(--danger);
	}

	.who {
		display: flex;
		align-items: center;
		gap: 0.6rem;
	}

	.name {
		padding: 0;
		border: none;
		background: none;
		font-weight: 700;
		text-decoration: underline dotted var(--muted);
		text-underline-offset: 3px;
	}

	.hp {
		position: relative;
		flex: 1;
		min-width: 6rem;
		height: 1.1rem;
		border-radius: 999px;
		background: #120e0b;
		border: 1px solid var(--border);
		overflow: hidden;
	}

	.fill {
		position: absolute;
		inset: 0 auto 0 0;
		background: linear-gradient(90deg, #8e2f25, #c0392b);
		transition: width 300ms ease;
	}

	.label {
		position: relative;
		display: block;
		text-align: center;
		font-size: 0.75rem;
		line-height: 1.05rem;
		font-variant-numeric: tabular-nums;
	}

	.chip {
		font-size: 0.75rem;
		padding: 0.05rem 0.45rem;
		border-radius: 999px;
		border: 1px solid var(--accent);
		color: var(--accent);
	}

	.status {
		margin: 0;
		font-size: 0.85rem;
		color: var(--muted);
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}

	.actions:empty {
		display: none;
	}

	.actions button {
		padding: 0.4rem 0.75rem;
	}

	.actions .action {
		border-color: var(--char);
	}

	small {
		margin-left: 0.3rem;
		opacity: 0.75;
		font-size: 0.75rem;
	}
</style>
