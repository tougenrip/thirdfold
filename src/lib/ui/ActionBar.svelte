<script lang="ts">
	import {
		canReach,
		inAttackRange,
		type AdventureView,
		type CharacterStatus
	} from '$lib/adventure/adventure';
	import { CHARACTERS } from '$lib/adventure/characters';
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
		send(action: RoomAction): boolean;
	}

	let { adventure, character, token, tokens, blocked, send }: Props = $props();

	const def = $derived(CHARACTERS[character.id]);
	const encounter = $derived(adventure.encounter);
	const acted = $derived(!!encounter?.acted.includes(character.id));
	const movesLeft = $derived(
		encounter ? Math.max(0, def.speed - (encounter.moved[character.id] ?? 0)) : null
	);
	const myTurn = $derived(
		!!encounter && encounter.phase === 'players' && !acted && !character.downed
	);
	const nearby = $derived(
		encounter || character.downed || adventure.stage === 'choosing'
			? []
			: adventure.interactables.filter((i) => canReach(blocked, token.pos, i.cells))
	);
	const targets = $derived(
		(encounter?.enemies ?? []).flatMap((e) => {
			const t = tokens.find((x) => x.id === e.tokenId);
			return t
				? [{ ...e, inReach: inAttackRange(blocked, token.pos, t.pos, def.attack.range) }]
				: [];
		})
	);
	const status = $derived.by(() => {
		if (character.downed) return `${def.name} is down.`;
		if (adventure.stage === 'choosing') return 'Waiting for the GM to begin.';
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

<section class="bar" aria-label="Your character" style:--char={def.color}>
	<div class="who">
		<span class="name">{def.name}</span>
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
	</div>
	<p class="status" aria-live="polite">{status}</p>
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
		{#if encounter && !character.downed}
			{#each targets as t (t.tokenId)}
				<button
					type="button"
					class="primary"
					disabled={!myTurn || !t.inReach}
					title={t.inReach
						? `${def.attack.name}: +${def.attack.toHit} to hit, ${def.attack.damage} damage`
						: def.attack.range === 1
							? 'Move next to it first'
							: 'Out of range or out of sight'}
					onclick={() => send({ type: 'adventure_attack', targetId: t.tokenId })}
				>
					Attack {t.name}
				</button>
			{/each}
			<button type="button" disabled={!myTurn} onclick={() => send({ type: 'adventure_end_turn' })}>
				End turn
			</button>
		{/if}
	</div>
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
		min-width: min(24rem, 100%);
	}

	.who {
		display: flex;
		align-items: center;
		gap: 0.6rem;
	}

	.name {
		font-weight: 700;
	}

	.hp {
		position: relative;
		flex: 1;
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
</style>
