<script lang="ts">
	import {
		canReach,
		inActionRange,
		INVESTIGATION_ACTIONS,
		PHYSICAL_ACTIONS,
		type AdventureView,
		type CharacterStatus,
		type CheckView,
		type Sense
	} from '$lib/adventure/adventure';
	import { BLEED_OUT_ROUNDS, STATUSES, type Action } from '$lib/adventure/characters';
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

	const def = $derived(character.def);
	const encounter = $derived(adventure.encounter);
	/** The turn's action is spent (other parts of a turn, a bonus action, may be left). */
	const acted = $derived(character.spent.includes('action'));
	/** An action as the rules show it: its summary and the part of a turn it takes. */
	const cardOf = (action: Action) =>
		character.card.actions.find((a) => a.id === action.id) ?? {
			id: action.id,
			summary: action.about,
			part: 'action',
			partName: 'Action'
		};
	const able = $derived(!character.downed && !character.dead);
	/** Whose turn it is, in a fight. */
	const up = $derived(encounter ? encounter.order[encounter.current] : undefined);
	const isMine = $derived(!!encounter && up?.characterId === character.id);
	const movesLeft = $derived(
		encounter
			? isMine
				? Math.max(0, encounter.speed - (encounter.moved[character.id] ?? 0))
				: 0
			: null
	);
	/** The character can use an action now: its turn, and it hasn't yet. */
	const myTurn = $derived(isMine && !acted && able);
	/** What is in reach to use; in a fight only what can be done in one (a torch, the Bell's rope), on this character's turn, as its action. */
	const nearby = $derived(
		!able || adventure.stage !== 'playing' || (encounter && !myTurn)
			? []
			: adventure.interactables.filter(
					(i) =>
						(!encounter || i.verbs.some((v) => v.inFight)) &&
						(i.carried || canReach(blocked, token.pos, i.cells))
				)
	);
	/** Actions that make sense now: everything in a fight, only healing outside one. */
	const actions = $derived(
		!able || adventure.stage !== 'playing'
			? []
			: def.actions.filter((a) => (encounter ? true : a.kind === 'heal'))
	);
	const chosen = $derived(actions.find((a) => a.id === targeting) ?? null);
	/** Listening and looking around work anywhere, outside a fight. */
	const canSense = $derived(able && !encounter && adventure.stage === 'playing');
	const SENSES: Sense[] = ['listen', 'observe'];

	/** "Wits check (d20+2 vs 8)": the test and difficulty, with the character's bonus (by the rules, from the server). */
	function checkText(check: CheckView): string {
		const bonus = check.bonus ? `${check.bonus > 0 ? '+' : ''}${check.bonus}` : '';
		return `${check.label}${check.save ? '' : ' check'} (d20${bonus} vs ${check.dc})`;
	}

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
			return [{ tokenId: t.id, name: c.def.name, detail, inReach }];
		});
	}

	const canUse = (action: Action) =>
		(encounter ? isMine && able && !character.spent.includes(cardOf(action).part) : true) &&
		character.usesLeft[action.id] !== 0;
	/** The parts of this turn still to take ("action", "bonus action"), for the status line. */
	const partsLeft = $derived([
		...new Set([
			...(acted ? [] : ['action']),
			...actions.filter(canUse).map((a) => cardOf(a).partName.toLowerCase())
		])
	]);

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
		if (adventure.stage !== 'playing') return 'The story is over.';
		if (chosen) return `${chosen.name}: choose a target, here or on the table.`;
		if (!encounter) {
			return nearby.length
				? 'Something here you can use.'
				: 'Click a cell to walk there. Go up to people and things.';
		}
		if (!isMine) return `${up?.name ?? 'Someone else'}'s turn…`;
		const cells = `${movesLeft} ${movesLeft === 1 ? 'cell' : 'cells'} of movement`;
		if (partsLeft.length === 0) return `Your turn: ${cells} left, then end your turn.`;
		const parts = partsLeft.map((p, i) => (i === 0 && p === 'action' ? 'one action' : `a ${p}`));
		return `Your turn: ${cells}${acted ? ' left' : ''}, ${parts.join(' and ')}.`;
	});
	/** What a verb is: how it investigates, or what it physically does. */
	function kindOf(v: AdventureView['interactables'][number]['verbs'][number]): string {
		return v.physical ? PHYSICAL_ACTIONS[v.physical] : INVESTIGATION_ACTIONS[v.action];
	}
	const hpPercent = $derived(Math.round((100 * character.hp) / character.maxHp));
</script>

<section class="bar" class:down={!able} aria-label="Your character" style:--char={def.color}>
	<div class="who">
		<span class="seal" aria-hidden="true"></span>
		<button type="button" class="ghost name" onclick={onSheet} title="Character sheet"
			>{def.name}</button
		>
		<span
			class="hp"
			role="meter"
			aria-label="Hit points"
			aria-valuenow={character.hp}
			aria-valuemin="0"
			aria-valuemax={character.maxHp}
		>
			<span class="fill" style:transform={`scaleX(${hpPercent / 100})`}></span>
			<span class="label">{character.hp}/{character.maxHp} HP</span>
		</span>
		{#each character.statuses as s (s.id)}
			<span class="chip" title={STATUSES[s.id].about}>{STATUSES[s.id].name}</span>
		{/each}
		{#each character.carrying as item (item.id)}
			<span class="chip carrying" title="Carrying">{item.name}</span>
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
					{t.name} <small class="num">{t.detail}</small>
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
				{#each i.verbs.filter((v) => !encounter || v.inFight) as v (v.id)}
					<button
						type="button"
						class="primary"
						disabled={v.tried}
						title={v.tried
							? `${def.name} has tried this. Someone else might see more.`
							: v.check
								? checkText(v.check)
								: kindOf(v)}
						onclick={() => send({ type: 'adventure_interact', targetId: i.id, verb: v.id })}
					>
						<small class="kind">{kindOf(v)}</small>
						{v.label}
						{#if v.check && !v.tried}<small class="num">{v.check.dc}</small>{/if}
					</button>
				{/each}
			{/each}
			{#if canSense}
				{#each SENSES as sense (sense)}
					<button
						type="button"
						title={sense === 'listen'
							? 'Listen closely where you stand'
							: 'Take a careful look around you'}
						onclick={() => send({ type: 'adventure_sense', sense })}
					>
						{INVESTIGATION_ACTIONS[sense]}
					</button>
				{/each}
			{/if}
			{#each actions as action (action.id)}
				{@const left = character.usesLeft[action.id]}
				<button
					type="button"
					class="action"
					disabled={!canUse(action)}
					title={`${cardOf(action).summary}. ${action.about}`}
					onclick={() => pick(action)}
				>
					{#if cardOf(action).part !== 'action'}<small class="kind">{cardOf(action).partName}</small
						>{/if}
					{action.name}
					{#if left !== null && left !== undefined}<small class="num">{left} left</small>{/if}
				</button>
			{/each}
			{#if encounter && able}
				<button
					type="button"
					class:primary={isMine && partsLeft.length === 0}
					disabled={!isMine}
					onclick={() => send({ type: 'adventure_end_turn' })}
				>
					End turn
				</button>
			{/if}
		</div>
	{/if}
</section>

<style>
	.kind {
		display: block;
		font-size: var(--fs-2xs);
		opacity: 0.75;
	}

	.bar {
		display: grid;
		gap: var(--sp-3);
		padding: var(--sp-4) var(--sp-5);
		background: var(--panel);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		backdrop-filter: blur(6px);
		min-width: min(26rem, 100%);
	}

	.bar.down {
		border-color: var(--danger);
	}

	.who {
		display: flex;
		align-items: center;
		gap: var(--sp-4);
	}

	.seal {
		flex: none;
		width: 0.7rem;
		height: 0.7rem;
		border-radius: 50%;
		background: var(--char);
	}

	.name {
		padding: 0;
		font-weight: 700;
		color: var(--text);
		text-decoration: underline dotted var(--muted);
		text-underline-offset: 3px;
	}

	.hp {
		position: relative;
		flex: 1;
		min-width: 6rem;
		height: 1.1rem;
		border-radius: var(--radius-pill);
		background: var(--panel-sunk);
		border: 1px solid var(--border);
		overflow: hidden;
	}

	.fill {
		position: absolute;
		inset: 0;
		background: var(--blood);
		transform-origin: left;
		transition: transform var(--dur) var(--ease-out);
	}

	.label {
		position: relative;
		display: block;
		text-align: center;
		font-size: var(--fs-xs);
		line-height: 1.05rem;
		font-variant-numeric: tabular-nums;
	}

	.chip {
		font-size: var(--fs-xs);
		padding: var(--sp-1) var(--sp-4);
		border-radius: var(--radius-pill);
		border: 1px solid var(--accent);
		color: var(--accent);
	}
	.chip.carrying {
		border-color: var(--muted);
		color: inherit;
	}

	.status {
		margin: 0;
		font-size: var(--fs-sm);
		color: var(--muted);
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--sp-3);
	}

	.actions:empty {
		display: none;
	}

	.actions button {
		padding: var(--sp-3) var(--sp-5);
	}

	.actions .action {
		border-color: var(--char);
	}

	small {
		margin-left: var(--sp-3);
		opacity: 0.75;
		font-size: var(--fs-xs);
	}
</style>
