<script lang="ts">
	import type { Snippet } from 'svelte';
	import { resolve } from '$app/paths';
	import type { LibraryListing, StoryFacts } from '$lib/game/library';
	import { describeFacts, describePlays } from './rating';
	import { inSentence, lastPlayed } from './when';
	import StoryCover from './StoryCover.svelte';
	import Stars from './Stars.svelte';

	/**
	 * One adventure opened in the library: its cover beside its words (what it's
	 * about, how it greets the party, what it holds), and the way to run it.
	 * `listing` is there for a published adventure, absent for a built-in one.
	 */
	interface Props {
		id: string;
		title: string;
		about: string;
		opening: string;
		facts: StoryFacts;
		listing: LibraryListing | null;
		actions: Snippet;
	}

	let { id, title, about, opening, facts, listing, actions }: Props = $props();
</script>

<article class="story">
	<div class="cover">
		<StoryCover {id} {title} size="large" />
	</div>
	<div class="text">
		<h1>{title}</h1>
		{#if listing}
			<p class="byline">
				by <a href={resolve(`/library?creator=${listing.creator.id}`)}>{listing.creator.name}</a>
				{#if listing.version > 1}· version {listing.version}{/if}
				· updated {inSentence(lastPlayed(listing.publishedAt))}
			</p>
		{:else}
			<p class="byline">Made with thirdfold · on every new table</p>
		{/if}
		{#if about}<p class="about">{about}</p>{/if}
		{#if opening}
			<blockquote class="opening"><p>{opening}</p></blockquote>
		{/if}
		<p class="facts">{describeFacts(facts)}</p>
		{#if listing}
			<p class="facts"><Stars rating={listing.rating} /> · {describePlays(listing.plays)}</p>
		{/if}
		<div class="actions">{@render actions()}</div>
	</div>
</article>

<style>
	.story {
		display: grid;
		grid-template-columns: minmax(12rem, 20rem) minmax(0, 1fr);
		gap: var(--sp-8) calc(var(--sp-8) * 1.5);
		align-items: start;
	}

	.text {
		display: grid;
		gap: var(--sp-5);
		max-width: 60ch;
	}

	h1 {
		margin: 0;
		font-size: var(--fs-2xl);
	}

	p {
		margin: 0;
	}

	.byline,
	.facts {
		color: var(--muted);
	}

	.facts {
		font-size: var(--fs-sm);
	}

	.about {
		font-size: var(--fs-lg);
	}

	/* The story's own first words, in its voice. */
	.opening {
		margin: 0;
		padding: var(--sp-5) var(--sp-6);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		font-family: var(--font-display);
		font-style: italic;
	}

	.actions {
		display: grid;
		gap: var(--sp-3);
		justify-items: start;
		margin-top: var(--sp-3);
	}

	@media (max-width: 48rem) {
		.story {
			grid-template-columns: 1fr;
		}

		.cover {
			max-width: 14rem;
		}
	}
</style>
