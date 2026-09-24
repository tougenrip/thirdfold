<script lang="ts">
	import { setMix } from '$lib/audio/engine';
	import { loadMix, saveMix, type Mix } from '$lib/audio/mix';

	/** The sound settings: mute, and how loud the music, ambience and effects are. */
	let mix = $state<Mix>(loadMix(localStorage));
	let open = $state(false);

	function change(next: Mix) {
		mix = next;
		setMix(next);
		saveMix(localStorage, next);
	}

	const LEVELS = [
		{ key: 'master', label: 'Volume' },
		{ key: 'music', label: 'Music' },
		{ key: 'ambience', label: 'Ambience' },
		{ key: 'effects', label: 'Effects' }
	] as const;
</script>

<div class="audio">
	<button
		type="button"
		aria-expanded={open}
		aria-label="Sound settings"
		title="Sound"
		onclick={() => (open = !open)}
	>
		{mix.muted ? 'Sound off' : 'Sound'}
	</button>
	{#if open}
		<div class="popover" role="group" aria-label="Sound">
			<label class="check">
				<input
					type="checkbox"
					checked={mix.muted}
					onchange={(e) => change({ ...mix, muted: e.currentTarget.checked })}
				/>
				Mute everything
			</label>
			{#each LEVELS as l (l.key)}
				<label class="level">
					<span>{l.label}</span>
					<input
						type="range"
						min="0"
						max="1"
						step="0.05"
						value={mix[l.key]}
						disabled={mix.muted}
						oninput={(e) => change({ ...mix, [l.key]: Number(e.currentTarget.value) })}
					/>
				</label>
			{/each}
		</div>
	{/if}
</div>

<style>
	.audio {
		position: relative;
	}

	.popover {
		position: absolute;
		top: calc(100% + 0.4rem);
		right: 0;
		display: grid;
		gap: 0.5rem;
		width: 14rem;
		padding: 0.75rem;
		background: var(--panel-solid);
		border: 1px solid var(--border);
		border-radius: 10px;
		box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
		z-index: 5;
	}

	.check {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.85rem;
	}

	.level {
		display: grid;
		grid-template-columns: 5rem 1fr;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.85rem;
		color: var(--muted);
	}
</style>
