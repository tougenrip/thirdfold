<script lang="ts">
	import { asset } from '$app/paths';

	/**
	 * An adventure as a book on the library's shelf: a leather cover (its colour
	 * from the adventure's id, so it's always the same book) with the title set
	 * on it and thirdfold's mark pressed in brass. Decorative: the title is
	 * repeated in text beside it.
	 */
	interface Props {
		id: string;
		title: string;
		size?: 'shelf' | 'large';
	}

	let { id, title, size = 'shelf' }: Props = $props();

	/** Leathers a bindery would stock: oxblood, forest, navy, tan, plum, teal. */
	const LEATHERS = ['#5b2a1f', '#2f3d2a', '#243449', '#51341c', '#3b2340', '#1f3a3a'];

	const leather = $derived.by(() => {
		let h = 0;
		for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
		return LEATHERS[h % LEATHERS.length];
	});
</script>

<div
	class="cover"
	class:large={size === 'large'}
	style:--leather={leather}
	style:--mark={`url(${asset('/brand/thirdfold-mark-mono.svg')})`}
	aria-hidden="true"
>
	<span class="title">{title}</span>
	<span class="mark"></span>
</div>

<style>
	.cover {
		position: relative;
		display: grid;
		grid-template-rows: 1fr auto;
		justify-items: center;
		align-items: center;
		aspect-ratio: 3 / 4;
		padding: 14% 12% 10%;
		overflow: hidden;
		border-radius: var(--radius-sm) var(--radius-md) var(--radius-md) var(--radius-sm);
		background:
			linear-gradient(90deg, rgba(0, 0, 0, 0.45), rgba(0, 0, 0, 0) 9%),
			radial-gradient(120% 80% at 70% 15%, rgba(255, 240, 215, 0.12), transparent 60%),
			var(--leather);
		box-shadow:
			inset 0 0 0 1px rgba(255, 236, 210, 0.08),
			var(--shadow-sm);
		color: #f0d49e;
		text-align: center;
	}

	/* A gilt frame tooled into the leather. */
	.cover::before {
		content: '';
		position: absolute;
		inset: 7% 8% 7% 11%;
		border: 1px solid rgba(224, 164, 88, 0.45);
		border-radius: var(--radius-sm);
		pointer-events: none;
	}

	.title {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: var(--fs-md);
		line-height: 1.15;
		text-wrap: balance;
		text-shadow: 0 1px 0 rgba(0, 0, 0, 0.5);
	}

	.large .title {
		font-size: var(--fs-xl);
	}

	.mark {
		width: 42%;
		aspect-ratio: 5 / 4;
		background: currentColor;
		opacity: 0.55;
		mask: var(--mark) center / contain no-repeat;
	}
</style>
