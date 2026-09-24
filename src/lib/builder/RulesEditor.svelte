<script lang="ts">
	import { without, type DraftRule as Rule } from './draft';
	import EffectsEditor from './EffectsEditor.svelte';
	import WhenEditor from './WhenEditor.svelte';

	/** Rules: the first whose conditions hold is the one that happens (one without conditions always holds). */
	let { rules = $bindable() }: { rules: Rule[] } = $props();

	const setRule = (i: number, next: Rule) => (rules = rules.map((r, j) => (j === i ? next : r)));
</script>

<ol class="rules">
	{#each rules as rule, i (i)}
		<li>
			<details open={!rule.if}>
				<summary>{rule.if ? 'If…' : 'Otherwise (always)'}</summary>
				<WhenEditor
					bind:when={
						() => rule.if,
						(when) => {
							setRule(i, when ? { ...rule, if: when } : without(rule, 'if'));
						}
					}
				/>
			</details>
			<EffectsEditor
				bind:effects={() => [...rule.do], (d) => setRule(i, { ...rule, do: d })}
				label="Then"
			/>
			<button
				type="button"
				class="remove"
				onclick={() => (rules = rules.filter((_, j) => j !== i))}
			>
				Remove this rule
			</button>
		</li>
	{/each}
</ol>
<button type="button" onclick={() => (rules = [...rules, { do: [] }])}>Add a rule</button>

<style>
	.rules {
		margin: 0;
		padding-left: 1.2rem;
		display: grid;
		gap: 0.5rem;
	}

	summary {
		cursor: pointer;
		font-size: 0.8rem;
		color: var(--muted);
	}

	.remove {
		font-size: 0.75rem;
		justify-self: start;
		margin-top: 0.2rem;
	}
</style>
