<script lang="ts" module>
	// A start or a return resets the room, which mounts this panel afresh: keep it open.
	let shownOpen = false;
</script>

<script lang="ts">
	import type { AdventureView } from '$lib/adventure/adventure';
	import { CAMPAIGN_LIMITS, type RosterEntryView, type RosterStatus } from '$lib/game/campaign';
	import type { CampaignReply, RoomAction } from '$lib/net/room-connection.svelte';

	/**
	 * The GM's campaigns (milestone 58): a party carried from adventure to
	 * adventure. Begin or open one at the table, and every adventure started
	 * here brings its active characters; return a finished story to it to
	 * write its history, rest the party and advance the survivors. The server
	 * keeps the campaign and decides everything; this only asks.
	 */
	interface Props {
		adventure: AdventureView | null;
		reply: CampaignReply | null;
		send(action: RoomAction): boolean;
	}

	let { adventure, reply, send }: Props = $props();

	let open = $state(shownOpen);
	$effect(() => {
		shownOpen = open;
	});
	// Asked once the panel is open, and again after a campaign is put away.
	$effect(() => {
		if (open && !reply?.campaigns) send({ type: 'campaign_list' });
	});

	const current = $derived(reply?.current ?? null);
	const others = $derived((reply?.campaigns ?? []).filter((c) => c.id !== current?.id));
	let name = $state('');

	/** The story here is played for the open campaign, and not yet back in it. */
	const story = $derived(
		adventure?.campaign && current && adventure.campaign.id === current.id
			? adventure.campaign
			: null
	);
	const over = $derived(adventure?.stage === 'complete' || adventure?.stage === 'defeat');
	let advance = $state(true);

	function begin(e: SubmitEvent) {
		e.preventDefault();
		if (!name.trim()) return;
		send({ type: 'campaign_create', name: name.trim() });
		name = '';
	}

	function putAway() {
		send({ type: 'campaign_open', campaignId: null });
		send({ type: 'campaign_list' });
	}

	function returnStory() {
		const why = over
			? 'Write this story into the campaign?'
			: 'The story isn’t over. Return it to the campaign as left unfinished?';
		if (confirm(why)) send({ type: 'campaign_close', advance: over && advance });
	}

	function forget(id: string, title: string) {
		if (confirm(`Forget the campaign ${title}? Its roster and history go with it.`))
			send({ type: 'campaign_delete', campaignId: id });
	}

	const roster = (op: 'approve' | 'retire' | 'restore', e: RosterEntryView) =>
		send({ type: 'campaign_roster', op: { op, character: e.id } });

	function assign(e: RosterEntryView, value: string) {
		const player = value.trim() || null;
		if (player !== e.player)
			send({ type: 'campaign_roster', op: { op: 'assign', character: e.id, player } });
	}

	const STATUS: Record<RosterStatus, string> = {
		active: 'Comes along',
		pending: 'Waiting for you',
		retired: 'Retired',
		dead: 'Fallen'
	};
	const OUTCOME = { complete: 'finished', defeat: 'the party fell', abandoned: 'left unfinished' };
	const when = (at: string) => new Date(at).toLocaleDateString();
</script>

<details class="campaign" bind:open>
	<summary>Campaign{current ? `: ${current.name}` : ''}</summary>

	{#if !current}
		<p class="muted small">
			A campaign carries a party from one adventure to the next: their gear, their levels and the
			story so far. Open one here, and the next adventure you start brings its characters.
		</p>
		{#if others.length}
			<ul class="list" aria-label="Your campaigns">
				{#each others as c (c.id)}
					<li>
						<span>
							<strong>{c.name}</strong>
							<span class="muted small"
								>{c.rules} · {c.characters}
								{c.characters === 1 ? 'character' : 'characters'} · {c.adventures}
								{c.adventures === 1 ? 'adventure' : 'adventures'}</span
							>
						</span>
						<span class="row">
							<button
								type="button"
								onclick={() => send({ type: 'campaign_open', campaignId: c.id })}>Open</button
							>
							<button type="button" class="quiet" onclick={() => forget(c.id, c.name)}
								>Forget</button
							>
						</span>
					</li>
				{/each}
			</ul>
		{/if}
		<form class="row" onsubmit={begin}>
			<input
				aria-label="New campaign’s name"
				placeholder="The Long Road"
				maxlength={CAMPAIGN_LIMITS.name}
				bind:value={name}
			/>
			<button type="submit" disabled={!name.trim()}>Begin a campaign</button>
		</form>
		<p class="muted small">Campaigns play by the fifth edition rules (SRD 5.2.1).</p>
	{:else}
		<p class="muted small">
			{current.rules.name} v{current.rules.version}
			{#each current.content as c (c.id)}· {c.name}{/each}
			· since {when(current.createdAt)}
		</p>
		{#if current.playing}
			<p class="small">Playing <strong>{current.playing.title}</strong></p>
		{/if}

		{#if story && !story.closed}
			<div class="return">
				{#if over}
					<label class="check">
						<input type="checkbox" bind:checked={advance} />
						{adventure?.stage === 'complete'
							? 'Survivors advance a level'
							: 'Nobody advances after a defeat'}
					</label>
				{/if}
				<button type="button" class="primary" onclick={returnStory}>
					Return {adventure?.title} to the campaign
				</button>
				<p class="muted small">
					Writes its history, keeps everyone’s gear, gives the party a full rest and puts new
					characters on the roster for you to approve.
				</p>
			</div>
		{:else if story?.closed}
			<p class="ok small">This story is written into the campaign.</p>
		{/if}

		<h3>Roster</h3>
		{#if current.roster.length}
			<ul class="list" aria-label="Roster">
				{#each current.roster as e (e.id)}
					<li class:faded={e.status === 'retired' || e.status === 'dead'}>
						<span>
							<strong>{e.name}</strong>
							<span class="muted small">{e.title ?? `level ${e.level}`}</span>
							<span class="status small" data-status={e.status}>{STATUS[e.status]}</span>
						</span>
						<span class="row">
							<input
								class="player"
								aria-label={`Who plays ${e.name}`}
								placeholder="Anyone"
								value={e.player ?? ''}
								onchange={(ev) => assign(e, ev.currentTarget.value)}
							/>
							{#if e.status === 'pending'}
								<button type="button" onclick={() => roster('approve', e)}>Approve</button>
							{/if}
							{#if e.status === 'active' || e.status === 'pending'}
								<button type="button" class="quiet" onclick={() => roster('retire', e)}
									>Retire</button
								>
							{:else if e.status === 'retired'}
								<button type="button" onclick={() => roster('restore', e)}>Bring back</button>
							{/if}
						</span>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="muted small">
				Nobody yet. Characters played in an adventure for the campaign join the roster when you
				return the story.
			</p>
		{/if}

		{#if current.history.length}
			<h3>The story so far</h3>
			<ol class="history">
				{#each current.history.toReversed() as h, i (i)}
					<li>
						<strong>{h.title}</strong>
						<span class="muted small"
							>{OUTCOME[h.outcome]}{h.ending ? `: ${h.ending}` : ''} · {when(h.endedAt)}</span
						>
						<div class="small">
							{#each h.characters as c, j (c.id)}{j ? ', ' : ''}{c.name}{c.fate === 'dead'
									? ' (fell)'
									: c.advancedTo
										? ` (level ${c.advancedTo})`
										: ''}{/each}
						</div>
					</li>
				{/each}
			</ol>
		{/if}
		{#if current.rewards.length}
			<h3>Rewards</h3>
			<p class="small">{current.rewards.join(' · ')}</p>
		{/if}

		<div class="row">
			<button
				type="button"
				class="quiet"
				disabled={!!story && !story.closed && !!adventure && adventure.stage !== 'choosing'}
				onclick={putAway}>Put the campaign away</button
			>
		</div>
	{/if}
</details>

<style>
	.campaign summary {
		cursor: pointer;
		font-weight: 600;
	}
	h3 {
		margin: var(--sp-3) 0 var(--sp-1);
		font-size: var(--fs-sm);
		color: var(--accent);
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--sp-2);
		align-items: center;
	}
	form.row,
	div.row {
		margin: var(--sp-2) 0;
	}
	form input {
		flex: 1;
		min-width: 0;
	}
	.list,
	.history {
		margin: var(--sp-2) 0;
		padding: 0;
		list-style: none;
		display: grid;
		gap: var(--sp-2);
	}
	.list li {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: var(--sp-2);
		align-items: center;
		border-bottom: 1px solid var(--border);
		padding-bottom: var(--sp-2);
	}
	.list li > span:first-child {
		display: grid;
		gap: 2px;
	}
	.faded {
		opacity: 0.6;
	}
	.status {
		color: var(--muted);
	}
	.status[data-status='pending'] {
		color: var(--accent);
	}
	.player {
		width: 8em;
	}
	.return {
		display: grid;
		gap: var(--sp-2);
		padding: var(--sp-3);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-md);
		margin: var(--sp-2) 0;
	}
	.check {
		display: flex;
		gap: var(--sp-2);
		align-items: center;
		font-size: var(--fs-sm);
	}
	.muted {
		color: var(--muted);
	}
	.small {
		font-size: var(--fs-xs);
	}
	.ok {
		color: var(--ok);
	}
	button.quiet {
		background: none;
		border-color: transparent;
		color: var(--muted);
	}
</style>
