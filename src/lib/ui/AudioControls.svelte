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
		<!-- Opens as a mixing desk at the top of the side column (see .mixer below). -->
		<div class="mixer" role="group" aria-label="Sound">
			<div class="faders">
				{#each LEVELS as l (l.key)}
					<label class="fader">
						<b>{Math.round(mix[l.key] * 100)}</b>
						<input
							type="range"
							min="0"
							max="1"
							step="0.05"
							value={mix[l.key]}
							disabled={mix.muted}
							aria-label={l.label}
							oninput={(e) => change({ ...mix, [l.key]: Number(e.currentTarget.value) })}
						/>
						<span>{l.label}</span>
					</label>
				{/each}
			</div>
			<label class="mute">
				<input
					type="checkbox"
					checked={mix.muted}
					onchange={(e) => change({ ...mix, muted: e.currentTarget.checked })}
				/>
				Mute everything
			</label>
		</div>
	{/if}
</div>

<style>
	.audio {
		position: relative;
	}

	/*
	 * The room's header bar has a backdrop blur, which makes it the containing block for fixed
	 * descendants: so this sits just below the bar at its right edge, over the top of the side
	 * column and exactly as wide (RoomView sets --side-w).
	 */
	.mixer {
		position: fixed;
		top: calc(100% + var(--sp-4));
		right: 0;
		width: min(var(--side-w, 17rem), 100%);
		display: grid;
		gap: var(--sp-5);
		padding: var(--sp-5) var(--sp-5) var(--sp-4);
		background: var(--panel);
		backdrop-filter: blur(6px);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-md);
		z-index: var(--z-overlay);
	}

	.faders {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		justify-items: center;
		gap: var(--sp-3);
	}

	.fader {
		display: grid;
		justify-items: center;
		gap: var(--sp-3);
		font-size: var(--fs-xs);
		color: var(--muted);
	}

	.fader b {
		font-weight: 500;
		color: var(--text);
		font-variant-numeric: tabular-nums;
	}

	/* The master fader leads. */
	.fader:first-child b,
	.fader:first-child span {
		color: var(--accent);
	}

	.fader input {
		writing-mode: vertical-lr;
		direction: rtl;
		width: 1.6rem;
		height: 7rem;
		min-height: 0;
		padding: 0;
		margin: 0;
		border: 0;
		background: none;
		box-shadow: none;
		accent-color: var(--accent);
	}

	.mute {
		display: flex;
		justify-content: center;
		align-items: center;
		gap: var(--sp-3);
		padding-top: var(--sp-4);
		border-top: 1px solid var(--border);
		font-size: var(--fs-sm);
	}
</style>
