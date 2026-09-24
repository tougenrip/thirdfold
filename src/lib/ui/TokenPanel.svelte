<script lang="ts" module>
	/** A token the GM has described but not yet dropped on a cell. */
	export interface TokenDraft {
		name: string;
		color: string;
		ownerId: string | null;
	}
</script>

<script lang="ts">
	import { NAME_MAX_LENGTH, type PublicPlayer } from '$lib/game/protocol';
	import { TOKEN_COLORS, type Token } from '$lib/game/token';
	import type { RoomAction } from '$lib/net/room-connection.svelte';
	import { MAX_VISION } from '$lib/game/visibility';
	import { MAX_LIGHT_RADIUS } from '$lib/game/lights';

	interface Props {
		isGm: boolean;
		tokens: readonly Token[];
		players: readonly PublicPlayer[];
		myId: string;
		selected: Token | null;
		placing: TokenDraft | null;
		onSelect(id: string | null): void;
		onPlace(draft: TokenDraft | null): void;
		send(action: RoomAction): void;
	}

	let { isGm, tokens, players, myId, selected, placing, onSelect, onPlace, send }: Props = $props();

	let draft = $state<TokenDraft>({ name: '', color: TOKEN_COLORS[0], ownerId: null });

	const owners = $derived(players.filter((p) => p.role === 'player'));
	const playerName = (id: string | null) =>
		id === null ? 'GM only' : (players.find((p) => p.id === id)?.name ?? 'Unknown');
	const listed = $derived(isGm ? tokens : tokens.filter((t) => t.ownerId === myId));

	function startPlacing(event: SubmitEvent) {
		event.preventDefault();
		const name = draft.name.trim();
		if (!name) return;
		onPlace({ ...draft, name });
		// Ready the form for the next token: fresh name, next colour.
		const next =
			(TOKEN_COLORS.indexOf(draft.color as (typeof TOKEN_COLORS)[number]) + 1) %
			TOKEN_COLORS.length;
		draft = { name: '', color: TOKEN_COLORS[next], ownerId: draft.ownerId };
	}

	function setLight(token: Token, value: number) {
		const light = Math.round(value);
		if (
			Number.isFinite(light) &&
			light >= 0 &&
			light <= MAX_LIGHT_RADIUS &&
			light !== token.light
		) {
			send({ type: 'token_update', tokenId: token.id, patch: { light } });
		}
	}

	function setVision(token: Token, value: number) {
		const vision = Math.round(value);
		if (Number.isFinite(vision) && vision >= 0 && vision <= MAX_VISION && vision !== token.vision) {
			send({ type: 'token_update', tokenId: token.id, patch: { vision } });
		}
	}

	function rename(token: Token, value: string) {
		const name = value.trim();
		if (name && name !== token.name) {
			send({ type: 'token_update', tokenId: token.id, patch: { name } });
		}
	}
</script>

<section class="panel" aria-label="Tokens">
	<h2>{isGm ? 'Tokens' : 'Your tokens'}</h2>

	{#if listed.length === 0}
		<p class="muted">
			{isGm ? 'No tokens on the table yet.' : 'The GM has not given you a token yet.'}
		</p>
	{:else}
		<ul class="list">
			{#each listed as token (token.id)}
				<li>
					<button
						type="button"
						class="token-row"
						aria-pressed={selected?.id === token.id}
						onclick={() => onSelect(selected?.id === token.id ? null : token.id)}
					>
						<span class="swatch" style:background={token.color}></span>
						<span class="name">{token.name}</span>
						{#if isGm}<span class="muted small">{playerName(token.ownerId)}</span>{/if}
					</button>
				</li>
			{/each}
		</ul>
	{/if}

	{#if isGm && selected}
		<div class="inspector" aria-label="Selected token">
			<h3>Selected</h3>
			<input
				value={selected.name}
				maxlength={NAME_MAX_LENGTH}
				aria-label="Token name"
				onchange={(e) => rename(selected, e.currentTarget.value)}
			/>
			<label class="row">
				<span class="muted small">Controlled by</span>
				<select
					value={selected.ownerId ?? ''}
					onchange={(e) =>
						send({
							type: 'token_update',
							tokenId: selected.id,
							patch: { ownerId: e.currentTarget.value || null }
						})}
				>
					<option value="">GM only</option>
					{#each owners as p (p.id)}
						<option value={p.id}>{p.name}</option>
					{/each}
				</select>
			</label>
			<label class="row">
				<span class="muted small">Vision (cells, used when fog is on)</span>
				<input
					type="number"
					min="0"
					max={MAX_VISION}
					step="1"
					value={selected.vision}
					aria-label="Token vision"
					onchange={(e) => setVision(selected, e.currentTarget.valueAsNumber)}
				/>
			</label>
			<label class="row">
				<span class="muted small">Carried light (cells, 0 = none)</span>
				<input
					type="number"
					min="0"
					max={MAX_LIGHT_RADIUS}
					step="1"
					value={selected.light}
					aria-label="Token light"
					onchange={(e) => setLight(selected, e.currentTarget.valueAsNumber)}
				/>
			</label>
			<label class="row check">
				<input
					type="checkbox"
					checked={selected.hidden === true}
					onchange={(e) =>
						send({
							type: 'token_update',
							tokenId: selected.id,
							patch: { hidden: e.currentTarget.checked }
						})}
				/>
				<span class="muted small">Hidden from players (its owner still sees it)</span>
			</label>
			<div class="swatches" role="group" aria-label="Token colour">
				{#each TOKEN_COLORS as color (color)}
					<button
						type="button"
						class="swatch-btn"
						style:background={color}
						aria-label={`Colour ${color}`}
						aria-pressed={selected.color === color}
						onclick={() => send({ type: 'token_update', tokenId: selected.id, patch: { color } })}
					></button>
				{/each}
			</div>
			<button
				type="button"
				class="danger"
				onclick={() => send({ type: 'token_delete', tokenId: selected.id })}
			>
				Remove from table
			</button>
		</div>
	{/if}

	{#if isGm}
		<form class="new" onsubmit={startPlacing}>
			<h3>New token</h3>
			<input
				bind:value={draft.name}
				maxlength={NAME_MAX_LENGTH}
				placeholder="Name, e.g. Goblin"
				aria-label="New token name"
			/>
			<label class="row">
				<span class="muted small">Controlled by</span>
				<select bind:value={draft.ownerId}>
					<option value={null}>GM only</option>
					{#each owners as p (p.id)}
						<option value={p.id}>{p.name}</option>
					{/each}
				</select>
			</label>
			<div class="swatches" role="group" aria-label="New token colour">
				{#each TOKEN_COLORS as color (color)}
					<button
						type="button"
						class="swatch-btn"
						style:background={color}
						aria-label={`Colour ${color}`}
						aria-pressed={draft.color === color}
						onclick={() => (draft.color = color)}
					></button>
				{/each}
			</div>
			{#if placing}
				<button type="button" onclick={() => onPlace(null)}>Cancel placing</button>
			{:else}
				<button class="primary" type="submit" disabled={!draft.name.trim()}>
					Place on table
				</button>
			{/if}
		</form>
	{/if}
</section>

<style>
	.panel {
		display: grid;
		gap: 0.6rem;
	}

	h2,
	h3 {
		margin: 0;
		font-size: 0.8rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--muted);
	}

	h3 {
		font-size: 0.72rem;
	}

	.muted {
		color: var(--muted);
		margin: 0;
	}

	.small {
		font-size: 0.78rem;
	}

	.list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.2rem;
		max-height: 11rem;
		overflow-y: auto;
	}

	.token-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.3rem 0.45rem;
		background: transparent;
		border-color: transparent;
		text-align: left;
	}

	.token-row[aria-pressed='true'] {
		border-color: var(--accent);
	}

	.name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.swatch {
		width: 0.8rem;
		height: 0.8rem;
		border-radius: 50%;
		flex: none;
		border: 1px solid rgba(0, 0, 0, 0.4);
	}

	.inspector,
	.new {
		display: grid;
		gap: 0.45rem;
		padding-top: 0.6rem;
		border-top: 1px solid var(--border);
	}

	.row {
		display: grid;
		gap: 0.2rem;
	}

	.row.check {
		grid-template-columns: auto 1fr;
		align-items: center;
		gap: 0.4rem;
	}

	.swatches {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}

	.swatch-btn {
		width: 1.4rem;
		height: 1.4rem;
		padding: 0;
		border-radius: 50%;
		border: 2px solid transparent;
	}

	.swatch-btn[aria-pressed='true'] {
		border-color: var(--text);
	}

	.danger {
		border-color: var(--danger);
		color: var(--danger);
	}
</style>
