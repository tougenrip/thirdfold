<script lang="ts">
	import Steps from './Steps.svelte';
	import { currentStep, TUTORIAL, type TutorialProgress } from './tutorial';

	/** The interactive tutorial: one thing to try at a time, done when the player does it. */
	interface Props {
		progress: TutorialProgress;
		/** The first goal, to point the player at when they are ready. */
		goal: string | null;
		onStart(): void;
		onSkip(): void;
	}

	let { progress, goal, onStart, onSkip }: Props = $props();

	const step = $derived(currentStep(progress));
	const number = $derived(step ? TUTORIAL.indexOf(step) + 1 : TUTORIAL.length);
</script>

<section class="coach" aria-live="polite" aria-label="How to play">
	<Steps current={step ? 4 : 5} />
	{#if step}
		<p class="count">Try this · {number} of {TUTORIAL.length}</p>
		<h3>{step.title}</h3>
		<p class="text">{step.text}</p>
		<ul class="dots" aria-hidden="true">
			{#each TUTORIAL as s (s.id)}
				<li class:done={progress.done.includes(s.id)} class:now={s.id === step.id}></li>
			{/each}
		</ul>
		<button type="button" class="skip" onclick={onSkip}>Skip the tutorial</button>
	{:else}
		<p class="count">All done</p>
		<h3>You’re ready</h3>
		<p class="text">
			Your goals are in the story panel on the right, and they change as the story moves on.
			{#if goal}Start here: <strong>{goal}</strong>{/if}
		</p>
		<button type="button" class="primary" onclick={onStart}>Start</button>
	{/if}
</section>

<style>
	.coach {
		position: absolute;
		top: 5rem;
		left: 0.75rem;
		width: min(20rem, calc(100% - 1.5rem));
		display: grid;
		gap: 0.5rem;
		padding: 0.9rem 1rem;
		background: var(--panel-solid);
		border: 1px solid var(--accent);
		border-radius: 12px;
		box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
		z-index: 2;
	}

	.count {
		margin: 0.2rem 0 0;
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--muted);
	}

	h3 {
		margin: 0;
		color: var(--accent);
	}

	.text {
		margin: 0;
		line-height: 1.45;
		font-size: 0.92rem;
	}

	.dots {
		display: flex;
		gap: 0.3rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.dots li {
		width: 0.55rem;
		height: 0.55rem;
		border-radius: 50%;
		border: 1px solid var(--border);
	}

	.dots .done {
		background: var(--accent);
		border-color: var(--accent);
	}

	.dots .now {
		border-color: var(--accent);
	}

	.skip {
		justify-self: start;
		padding: 0;
		border: none;
		background: none;
		color: var(--muted);
		text-decoration: underline;
		font-size: 0.8rem;
	}

	.primary {
		justify-self: start;
	}
</style>
