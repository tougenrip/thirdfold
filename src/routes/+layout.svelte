<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import { play, setMix, unlock } from '$lib/audio/engine';
	import { loadMix } from '$lib/audio/mix';

	let { children } = $props();

	setMix(loadMix(localStorage));

	// Browsers only let a page make sound once someone has interacted with it.
	function wake() {
		unlock();
	}

	/** A soft tick for pressing a button: the table's UI has a sound too. */
	function click(event: MouseEvent) {
		if ((event.target as HTMLElement | null)?.closest('button:not(:disabled)')) {
			play([{ kind: 'ui', sound: 'click' }]);
		}
	}
</script>

<svelte:window onpointerdown={wake} onkeydown={wake} onclick={click} />

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>thirdfold</title>
</svelte:head>

{@render children()}
