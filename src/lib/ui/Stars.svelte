<script lang="ts">
	import type { Rating } from '$lib/game/library';
	import { plural } from './rating';

	/** A rating as the library shows it; the star is decoration, read out as "out of 5". */
	let { rating }: { rating: Rating | null } = $props();
</script>

{#if rating}
	<span aria-hidden="true">★</span>
	{rating.average.toFixed(1)}<span class="visually-hidden"> out of 5</span>
	· {plural(rating.count, 'rating')}
{:else}
	Not rated yet
{/if}
