<script lang="ts">
	// Loaded only in dev builds: in production `import.meta.env.DEV` is false and this is dropped.
	const turntable = import.meta.env.DEV ? import('./Turntable.svelte') : null;
</script>

<svelte:head>
	<title>Asset turntable · thirdfold</title>
</svelte:head>

{#if turntable}
	{#await turntable then { default: Turntable }}
		<Turntable />
	{/await}
{/if}
