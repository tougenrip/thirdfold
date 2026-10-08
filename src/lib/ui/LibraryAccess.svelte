<script lang="ts">
	import {
		GRANT_LIMITS,
		grantActive,
		parseNewGrant,
		type Grant,
		type GrantTarget,
		type LibraryAccess
	} from '$lib/game/access';
	import type { MyAdventure } from '$lib/game/library';
	import type { LibraryOp } from '$lib/game/protocol';
	import { grantAccess, manageAdventure, revokeGrant, type LibraryHome } from '$lib/net/library';
	import { inSentence, lastPlayed } from '$lib/ui/when';

	/**
	 * Who may find, open and play one of a creator's items, and whom it is
	 * shared with (milestone 54). The server decides every request; this asks.
	 */
	interface Props {
		item: MyAdventure;
		gmKey: string;
		/** The creator's items changed (the server's answer). */
		onChange(home: { mine: MyAdventure[] } | LibraryHome): void;
	}

	let { item, gmKey, onChange }: Props = $props();

	const LEVELS: { access: LibraryAccess; op: LibraryOp; label: string; note: string }[] = [
		{
			access: 'public',
			op: 'list',
			label: 'Public',
			note: 'In the library: anyone finds it, plays it and puts it in a collection.'
		},
		{
			access: 'restricted',
			op: 'restrict',
			label: 'Restricted',
			note: 'In the library, but only those you share it with may open or play it.'
		},
		{
			access: 'private',
			op: 'unlist',
			label: 'Private',
			note: 'Not in the library: only you and those you share it with know it is there.'
		}
	];

	let kind = $state<GrantTarget['kind']>('creator');
	let targetId = $state('');
	let role = $state<'member' | 'collaborator'>('member');
	let hours = $state('');
	let note = $state('');
	let busy = $state(false);
	let error = $state<string | null>(null);

	const now = $derived(Date.now());
	const active = $derived(item.grants.filter((g) => grantActive(g, now)));
	const past = $derived(item.grants.filter((g) => !grantActive(g, now)));

	function whom(t: GrantTarget): string {
		if (t.kind === 'creator') return `Creator ${t.id}`;
		if (t.kind === 'collection') return `Collection ${t.id.slice(0, 8)}…`;
		return `Table ${t.id}`;
	}
	const roleWord = (g: Grant) =>
		g.target.kind === 'collection'
			? 'may carry it'
			: g.role === 'collaborator'
				? 'collaborator'
				: 'may play';

	async function act(fn: () => Promise<{ mine: MyAdventure[] } | LibraryHome>) {
		busy = true;
		error = null;
		try {
			onChange(await fn());
			return true;
		} catch (err) {
			error = (err as Error).message;
			return false;
		} finally {
			busy = false;
		}
	}

	async function setLevel(op: LibraryOp) {
		await act(async () => ({ mine: await manageAdventure(gmKey, item.id, op) }));
	}

	async function share(e: SubmitEvent) {
		e.preventDefault();
		const id = targetId.trim();
		const parsed = parseNewGrant({
			target: { kind, id: kind === 'room' ? id.toUpperCase() : id.toLowerCase() },
			role: kind === 'creator' ? role : 'member',
			...(hours.trim() ? { hours: Number(hours) } : {}),
			...(note.trim() ? { note: note.trim() } : {})
		});
		if (!parsed.ok) return void (error = parsed.error);
		if (await act(() => grantAccess(gmKey, item.id, parsed.grant))) targetId = hours = note = '';
	}
</script>

<div class="access">
	<fieldset disabled={busy}>
		<legend>Who may find and play it</legend>
		{#each LEVELS as level (level.access)}
			<label class="level">
				<input
					type="radio"
					name={`access-${item.id}`}
					checked={item.access === level.access}
					onchange={() => setLevel(level.op)}
				/>
				<span><strong>{level.label}</strong> <span class="muted">{level.note}</span></span>
			</label>
		{/each}
	</fieldset>

	<div class="grants">
		<h4>Shared with</h4>
		{#if active.length}
			<ul>
				{#each active as g (g.id)}
					<li>
						<span>
							<strong>{whom(g.target)}</strong>
							<span class="muted">
								· {roleWord(g)} · since {inSentence(lastPlayed(g.at))}{g.expires
									? ` · until ${new Date(g.expires).toLocaleString()}`
									: ''}{g.note ? ` · ${g.note}` : ''}
							</span>
						</span>
						<button
							type="button"
							disabled={busy}
							onclick={() => act(() => revokeGrant(gmKey, item.id, g.id))}>Revoke</button
						>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="muted">Nobody yet.</p>
		{/if}
		{#if past.length}
			<details>
				<summary class="muted">{past.length} revoked or run out</summary>
				<ul>
					{#each past as g (g.id)}
						<li class="muted">
							{whom(g.target)} · {roleWord(g)} · {g.revoked
								? `revoked ${new Date(g.revoked).toLocaleString()}`
								: `ran out ${new Date(g.expires!).toLocaleString()}`}
						</li>
					{/each}
				</ul>
			</details>
		{/if}
	</div>

	<form class="share" onsubmit={share}>
		<h4>Share it</h4>
		<div class="row">
			<label>
				With
				<select bind:value={kind} disabled={busy}>
					<option value="creator">a creator</option>
					<option value="collection">a collection</option>
					<option value="room">a table, for a while</option>
				</select>
			</label>
			<label class="grow">
				{kind === 'creator'
					? 'Their creator id'
					: kind === 'collection'
						? 'The collection’s id (from its link)'
						: 'The table’s code'}
				<input
					bind:value={targetId}
					required
					disabled={busy}
					maxlength={32}
					autocomplete="off"
					spellcheck="false"
				/>
			</label>
			{#if kind === 'creator'}
				<label>
					As
					<select bind:value={role} disabled={busy}>
						<option value="member">may play it</option>
						<option value="collaborator">a collaborator</option>
					</select>
				</label>
			{/if}
			<label>
				For hours
				<input
					bind:value={hours}
					inputmode="numeric"
					disabled={busy}
					placeholder={kind === 'room' ? `${GRANT_LIMITS.roomHours}` : 'always'}
					size="6"
				/>
			</label>
		</div>
		<label>
			Note <span class="muted">(only you see it)</span>
			<input bind:value={note} maxlength={GRANT_LIMITS.note} disabled={busy} />
		</label>
		<p class="muted small">
			{kind === 'creator'
				? role === 'collaborator'
					? 'A collaborator may also add versions, put it in their collections and export what they play.'
					: 'They may open and play it, not pass it on or export it.'
				: kind === 'collection'
					? 'Anyone who runs that collection plays it there, nowhere else.'
					: 'Whoever runs that table plays it, for at most a day.'}
		</p>
		<button type="submit" disabled={busy}>Share</button>
	</form>
	{#if error}<p class="error" role="alert">{error}</p>{/if}
</div>

<style>
	.access {
		display: grid;
		gap: var(--sp-4);
		padding: var(--sp-4) 0 var(--sp-2);
		font-size: var(--fs-sm);
	}
	fieldset {
		border: 0;
		padding: 0;
		margin: 0;
		display: grid;
		gap: var(--sp-2);
	}
	legend,
	h4 {
		margin: 0 0 var(--sp-2);
		font-size: var(--fs-sm);
		font-weight: 600;
	}
	.level {
		display: flex;
		gap: var(--sp-3);
		align-items: baseline;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: var(--sp-2);
	}
	li {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: var(--sp-3);
		overflow-wrap: anywhere;
	}
	.share {
		display: grid;
		gap: var(--sp-3);
	}
	.share label {
		display: grid;
		gap: var(--sp-1);
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--sp-3);
		align-items: end;
	}
	.grow {
		flex: 1;
		min-width: 12rem;
	}
	.share button {
		justify-self: start;
	}
	.muted {
		color: var(--muted);
	}
	.small {
		font-size: var(--fs-xs);
	}
	.error {
		color: var(--danger);
		margin: 0;
	}
</style>
