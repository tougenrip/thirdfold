<script lang="ts">
	import type { Snippet } from 'svelte';
	import { resolve } from '$app/paths';
	import StoryCover from './StoryCover.svelte';

	/**
	 * An adventure standing on a library shelf: its cover and title (both open
	 * it), a few lines about it (`children`) and the way to run it (`action`).
	 */
	interface Props {
		id: string;
		title: string;
		/** What opens it on the library page: `story=<id>` or `built=<id>`. */
		opens: string;
		children: Snippet;
		action: Snippet;
	}

	let { id, title, opens, children, action }: Props = $props();

	const href = $derived(resolve(`/library?${opens}`));
</script>

<li class="book">
	<a class="cover" {href} tabindex="-1"><StoryCover {id} {title} /></a>
	<h3><a {href}>{title}</a></h3>
	{@render children()}
	{@render action()}
</li>

<style>
	.book {
		display: grid;
		align-content: start;
		gap: var(--sp-3);
	}

	.cover {
		display: block;
		text-decoration: none;
		margin-bottom: var(--sp-3);
		border-radius: var(--radius-md);
		transition: transform var(--dur) var(--ease-out);
	}

	/* Taking a book off the shelf. */
	.book:hover .cover {
		transform: translateY(-4px);
	}

	h3 {
		margin: 0;
		font-size: var(--fs-lg);
	}

	h3 a {
		color: var(--text);
		text-decoration: none;
	}

	h3 a:hover {
		text-decoration: underline;
		text-decoration-color: var(--accent);
	}

	.book :global(p) {
		margin: 0;
		font-size: var(--fs-sm);
		color: var(--muted);
	}

	.book :global(.about) {
		display: -webkit-box;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow: hidden;
		font-size: var(--fs-md);
		color: var(--text);
	}

	.book :global(.run) {
		justify-self: start;
		margin-top: var(--sp-3);
	}

	/* Brass marks the one action in reach: a book's key lights up as you reach for it. */
	.book:hover :global(.run:not(:disabled)),
	.book:focus-within :global(.run:not(:disabled)) {
		background: var(--accent);
		color: var(--accent-text);
	}

	@media (max-width: 48rem) {
		h3 a {
			display: inline-block;
			padding-block: var(--sp-2);
		}

		.book :global(.run) {
			min-height: 2.75rem;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.book:hover .cover {
			transform: none;
		}
	}
</style>
