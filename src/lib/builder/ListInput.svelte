<script lang="ts">
	import { formatList, parseList } from './draft';

	/** A list written with commas; `options` names a datalist to suggest from. */
	let {
		value = $bindable(),
		label,
		options,
		placeholder = ''
	}: {
		value: readonly string[] | undefined;
		label: string;
		options?: string;
		placeholder?: string;
	} = $props();
</script>

<input
	aria-label={label}
	list={options}
	{placeholder}
	value={formatList(value)}
	onchange={(e) => {
		const items = parseList(e.currentTarget.value);
		value = items.length ? items : undefined;
	}}
/>
