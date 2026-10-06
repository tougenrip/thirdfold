<script lang="ts" module>
	// A move resets the room, which mounts this panel afresh: what it was showing carries over.
	let shownOpen = false;
	let askedBefore = -1;
</script>

<script lang="ts">
	import type { UpgradeReview, VersionsView } from '$lib/adventure/versions';
	import type { RoomAction } from '$lib/net/room-connection.svelte';

	/**
	 * The GM's view of what the story is pinned to (milestone 55), and moving
	 * it to another version of its library content: reviewed first (what
	 * changes, whether the story fits), then moved only when the GM says so,
	 * and moved back the same way. The server decides; this only asks.
	 */
	interface Props {
		versions: VersionsView;
		/** The latest review or move the server answered. */
		reply: { review: UpgradeReview; applied: boolean; seq: number } | null;
		send(action: RoomAction): boolean;
	}

	let { versions, reply, send }: Props = $props();

	/** The reply this panel asked for (an older one isn't shown). */
	let asked = $state(askedBefore);
	let open = $state(shownOpen);
	$effect(() => {
		shownOpen = open;
		askedBefore = asked;
	});
	const shown = $derived(reply && reply.seq > asked ? reply : null);
	let waiting = $state(false);
	$effect(() => {
		if (shown) waiting = false;
	});

	const lock = $derived(versions.lock);
	const short = (hash: string) => hash.slice(0, 8);

	/** Asks, and stops waiting after a while if the answer was an error (shown elsewhere). */
	function ask() {
		asked = reply?.seq ?? -1;
		waiting = true;
		setTimeout(() => (waiting = false), 6000);
	}

	function review(what: 'adventure' | 'collection', version?: number) {
		ask();
		send({ type: 'adventure_upgrade', op: 'review', what, ...(version ? { version } : {}) });
	}

	function apply(r: UpgradeReview) {
		ask();
		send({ type: 'adventure_upgrade', op: 'apply', what: r.what, version: r.to });
	}

	const last = $derived(versions.steps.at(-1) ?? null);
</script>

<details class="versions" bind:open>
	<summary>Versions</summary>
	<dl>
		<dt>Rules</dt>
		<dd>{lock.rules.name} <span class="muted">v{lock.rules.version}</span></dd>
		{#each lock.content as c (c.id)}
			<dt>Content</dt>
			<dd>
				{c.name} <span class="muted">{c.version} · build {short(c.build)}</span>
			</dd>
		{/each}
		<dt>Adventure</dt>
		<dd>
			{#if lock.adventure.kind === 'built-in'}
				Comes with thirdfold <span class="muted">(saved state v{lock.adventure.version})</span>
			{:else if lock.adventure.library}
				{lock.adventure.title}
				<span class="muted"
					>version {lock.adventure.library.version}, by {lock.adventure.library.creator.name}</span
				>
			{:else}
				{lock.adventure.title} <span class="muted">from a file</span>
			{/if}
		</dd>
		{#if lock.packs.length}
			<dt>Homebrew</dt>
			<dd>{lock.packs.map((p) => `${p.name} ${p.version}`).join(', ')}</dd>
		{/if}
		{#if lock.collection}
			<dt>Collection</dt>
			<dd>{lock.collection.title} <span class="muted">version {lock.collection.version}</span></dd>
		{/if}
	</dl>
	<p class="muted small">
		Its creator’s updates never change this story. Look for a newer version to see what would
		change, then move the story if you want to.
	</p>

	<div class="row">
		{#if versions.movable.adventure}
			<button type="button" disabled={waiting} onclick={() => review('adventure')}>
				Look for a newer version
			</button>
		{/if}
		{#if versions.movable.collection}
			<button type="button" disabled={waiting} onclick={() => review('collection')}>
				Look for a newer collection
			</button>
		{/if}
		{#if last}
			<button type="button" disabled={waiting} onclick={() => review(last.what, last.from)}>
				Back to version {last.from}…
			</button>
		{/if}
	</div>

	{#if shown}
		{@const r = shown.review}
		<div class="review" role="status">
			{#if shown.applied}
				<p class="ok">Moved the story {r.rollback ? 'back ' : ''}to version {r.to} of {r.title}.</p>
			{:else}
				<p>
					<strong>{r.title}</strong>: version {r.from} → {r.to}{r.rollback ? ' (back)' : ''}
				</p>
				{#if r.changes.length || r.packs.added.length || r.packs.removed.length}
					<ul class="changes">
						{#each r.changes as c (c.section)}
							<li>
								<strong>{c.section}</strong>
								{#if c.added.length}<span class="added">+ {c.added.join(', ')}</span>{/if}
								{#if c.removed.length}<span class="removed">− {c.removed.join(', ')}</span>{/if}
								{#if c.changed.length}<span class="muted">changed: {c.changed.join(', ')}</span
									>{/if}
							</li>
						{/each}
						{#if r.packs.added.length}<li>
								<strong>Homebrew</strong> <span class="added">+ {r.packs.added.join(', ')}</span>
							</li>{/if}
						{#if r.packs.removed.length}<li>
								<strong>Homebrew</strong>
								<span class="removed">− {r.packs.removed.join(', ')}</span>
							</li>{/if}
					</ul>
				{:else}
					<p class="muted">Nothing in the adventure changes.</p>
				{/if}
				{#if r.problems.length}
					<ul class="problems" role="alert">
						{#each r.problems as p (p)}<li>{p}</li>{/each}
					</ul>
				{:else}
					<button type="button" class="primary" disabled={waiting} onclick={() => apply(r)}>
						Move the story to version {r.to}
					</button>
				{/if}
			{/if}
		</div>
	{/if}

	{#if versions.steps.length}
		<p class="muted small">Moves so far:</p>
		<ol class="steps">
			{#each versions.steps as s, i (i)}
				<li class="muted small">
					{s.what === 'adventure' ? 'Adventure' : 'Collection'} version {s.from} → {s.to}{s.rollback
						? ' (back)'
						: ''} · {new Date(s.at).toLocaleString()}
				</li>
			{/each}
		</ol>
	{/if}
</details>

<style>
	dl {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: var(--sp-1) var(--sp-3);
		margin: var(--sp-2) 0;
		font-size: var(--fs-sm);
	}
	dt {
		color: var(--muted);
	}
	dd {
		margin: 0;
		overflow-wrap: anywhere;
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--sp-2);
		margin: var(--sp-2) 0;
	}
	.review {
		display: grid;
		gap: var(--sp-2);
		padding: var(--sp-3);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		font-size: var(--fs-sm);
	}
	.review p {
		margin: 0;
	}
	ul,
	ol {
		margin: 0;
		padding-left: var(--sp-5);
		display: grid;
		gap: var(--sp-1);
	}
	.changes li {
		overflow-wrap: anywhere;
	}
	.changes span {
		margin-left: var(--sp-2);
	}
	.added {
		color: var(--ok);
	}
	.removed,
	.problems {
		color: var(--danger);
	}
	.ok {
		color: var(--ok);
	}
	.muted {
		color: var(--muted);
	}
	.small {
		font-size: var(--fs-xs);
	}
	button.primary {
		justify-self: start;
	}
</style>
