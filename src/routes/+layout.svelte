<script lang="ts">
	import '../app.css';
	// The modern skin over app.css; delete this line to return to the classic look.
	import '../skin-modern.css';
	import favicon from '$lib/assets/favicon.svg';
	import { play, setMix, unlock } from '$lib/audio/engine';
	import { loadMix } from '$lib/audio/mix';
	import { onNavigate } from '$app/navigation';

	let { children } = $props();

	setMix(loadMix(localStorage));

	// Browsers only let a page make sound once someone has interacted with it.
	function wake() {
		unlock();
	}

	// Leaving the front page for a table folds the board shut and opens the room beneath it
	// (the keyframes are in app.css). Browsers without view transitions just navigate.
	onNavigate((navigation) => {
		if (!document.startViewTransition) return;
		if (navigation.from?.route.id !== '/' || navigation.to?.route.id !== '/room/[id]') return;
		if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
		return new Promise((resolve) => {
			document.startViewTransition(async () => {
				resolve();
				await navigation.complete;
			});
		});
	});

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
