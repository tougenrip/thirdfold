<script lang="ts">
	import type { GridPos } from '$lib/game/grid';
	import { formatCells, parseCells } from './draft';

	/** Cells written `x,y; x,y`; a mistake is marked and not taken until fixed. */
	let {
		value = $bindable(),
		label,
		placeholder = 'x,y; x,y'
	}: { value: GridPos[]; label: string; placeholder?: string } = $props();

	let invalid = $state(false);
</script>

<input
	aria-label={label}
	{placeholder}
	class:invalid
	value={formatCells(value)}
	onchange={(e) => {
		const cells = parseCells(e.currentTarget.value);
		invalid = cells === null;
		if (cells) value = cells;
	}}
/>

<style>
	.invalid {
		border-color: var(--danger);
	}
</style>
