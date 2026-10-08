<script lang="ts">
	import { describeTerms } from '$lib/content/licence';
	import type { RoomAction, SourcesReply } from '$lib/net/room-connection.svelte';

	/**
	 * The licensed sources installed on this server that the GM may use
	 * (milestone 59): what each is, whose, its terms in words and its credit,
	 * and Use to bring it to the story. The server decides who may use what;
	 * this only asks.
	 */
	interface Props {
		reply: SourcesReply | null;
		/** Ids of the licensed sources the story already has. */
		attached: string[];
		send(action: RoomAction): boolean;
	}

	let { reply, attached, send }: Props = $props();
	let asked = $state(-1);
	const shown = $derived(reply && reply.seq > asked ? reply : null);

	function ask() {
		asked = reply?.seq ?? -1;
		send({ type: 'content_sources' });
	}
	const kinds = (counts: Record<string, number>) =>
		Object.entries(counts)
			.map(([kind, n]) => `${n} ${kind}${n === 1 ? '' : 's'}`)
			.join(', ');
</script>

<div class="licensed">
	<button type="button" onclick={ask}>Licensed content…</button>
	{#if shown}
		{#if shown.sources.length}
			<ul aria-label="Licensed sources">
				{#each shown.sources as s (s.id)}
					<li>
						<strong>{s.name}</strong>
						<span class="badge">Licensed · {s.publisher}</span>
						<span class="muted small">{s.version}</span>
						{#if s.hypothetical}<p class="small muted">
								Hypothetical: made up for tests and docs.
							</p>{/if}
						<p class="small">{s.about}</p>
						<p class="small muted">{kinds(s.counts)}</p>
						<ul class="terms">
							{#each describeTerms(s.terms) as line (line)}<li>{line}</li>{/each}
						</ul>
						<p class="credit">{s.terms.licence.name} · {s.attribution}</p>
						<button
							type="button"
							disabled={!s.usable || attached.includes(s.id)}
							onclick={() => send({ type: 'adventure_pack', op: 'licensed', source: s.id })}
						>
							{attached.includes(s.id) ? 'In the story' : s.usable ? 'Use it' : 'Other rules'}
						</button>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="small muted">
				No licensed source on this server is yours to use. Its operator grants them by your creator
				id.
			</p>
		{/if}
	{/if}
</div>

<style>
	.licensed {
		display: grid;
		gap: var(--sp-2);
		justify-items: start;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: var(--sp-3);
		width: 100%;
	}
	.terms {
		gap: 0;
		padding-left: var(--sp-3);
		list-style: disc;
		font-size: var(--fs-xs);
		color: var(--muted);
	}
	.badge {
		font-size: var(--fs-xs);
		color: var(--accent);
		margin-left: var(--sp-1);
	}
	p {
		margin: var(--sp-1) 0 0;
	}
	.small {
		font-size: var(--fs-xs);
	}
	.muted {
		color: var(--muted);
	}
	.credit {
		font-size: var(--fs-2xs);
		color: var(--muted);
	}
</style>
