<script lang="ts">
	import {
		CHAT_MAX_LENGTH,
		parseChatInput,
		type ChatMessage,
		type LogAudience
	} from '$lib/game/chat';
	import { parseDice, STANDARD_DICE } from '$lib/game/dice';
	import type { RoomAction } from '$lib/net/room-connection.svelte';

	interface Props {
		log: readonly ChatMessage[];
		myId: string;
		send(action: RoomAction): boolean;
		onError(message: string): void;
	}

	let { log, myId, send, onError }: Props = $props();

	let draft = $state('');
	let list: HTMLOListElement;
	let stickToBottom = true;

	const time = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

	/** Marks entries not everyone at the table can read. */
	const privacy = (audience: LogAudience) =>
		audience === 'gm' ? 'GM only' : audience.players.includes(myId) ? 'Only you' : 'Private';

	function submit(event: SubmitEvent) {
		event.preventDefault();
		const input = parseChatInput(draft);
		if (input.type === 'roll') {
			// Same parser the server uses: catch typos here so the text stays editable.
			const parsed = parseDice(input.expression);
			if (!parsed.ok) return onError(parsed.error);
		}
		const sent =
			input.type === 'roll'
				? send(
						input.secret
							? { type: 'dice_roll', expression: input.expression, secret: true }
							: { type: 'dice_roll', expression: input.expression }
					)
				: draft.trim() && send({ type: 'chat_send', text: input.text });
		if (sent) draft = '';
	}

	function onScroll() {
		stickToBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 24;
	}

	// Follow new messages unless the reader has scrolled up to look at history.
	$effect.pre(() => {
		void log.length;
		const el = list;
		if (!el || !stickToBottom) return;
		// Runs after the DOM update; the panel may be gone by then (e.g. navigating away).
		queueMicrotask(() => {
			if (el.isConnected) el.scrollTop = el.scrollHeight;
		});
	});
</script>

<section class="chat" aria-label="Chat and dice">
	<ol class="log" bind:this={list} onscroll={onScroll} aria-live="polite">
		{#each log as m (m.seq)}
			<li class={m.kind} class:mine={'authorId' in m && m.authorId === myId}>
				{#if m.kind === 'system'}
					<span class="text">{m.text}</span>
					{#if m.audience}<span class="private">{privacy(m.audience)}</span>{/if}
				{:else if m.kind === 'narration'}
					{#if m.speaker}<span class="speaker">{m.speaker}</span>{/if}
					<p class="text">{m.text}</p>
					{#if m.audience}<span class="private">{privacy(m.audience)}</span>{/if}
				{:else if m.kind === 'check'}
					<header>
						<span class="author">{m.authorName}</span>
						<span class="versus">{m.action} · {m.stat}</span>
					</header>
					<p class="roll-result">
						<span class="expr">{m.roll.expression}</span>
						<span class="total num">{m.roll.total}</span>
						<span class="expr">vs {m.dc}</span>
						<span class="verdict" class:hit={m.success}>{m.success ? 'Found' : 'Nothing'}</span>
					</p>
				{:else if m.kind === 'ability'}
					<header>
						<span class="author">{m.authorName}</span>
						<span class="versus">{m.ability}{m.targetName ? ` → ${m.targetName}` : ''}</span>
					</header>
					<p class="text">
						{m.text}
						{#if m.roll}<span class="expr">({m.roll.expression}: {m.roll.total})</span>{/if}
					</p>
				{:else if m.kind === 'attack'}
					<header>
						<span class="author">{m.authorName}</span>
						<span class="versus">{m.attack} → {m.targetName}</span>
					</header>
					<p class="roll-result">
						<span class="expr">{m.toHit.expression}</span>
						<span class="total num">{m.toHit.total}</span>
						<span class="expr">vs {m.defense}</span>
						<span class="verdict" class:hit={m.hit}>{m.hit ? 'Hit' : 'Miss'}</span>
						{#if m.damage}
							<span class="expr">{m.damage.expression}</span>
							<span class="total num damage">{m.damage.total} damage</span>
						{/if}
					</p>
					{#if m.effect}<p class="outcome">{m.targetName} is {m.effect.toLowerCase()}.</p>{/if}
					{#if m.outcome}<p class="outcome">{m.outcome}</p>{/if}
				{:else}
					<header>
						<span class="author">{m.authorName}</span>
						<time datetime={new Date(m.at).toISOString()}>{time.format(m.at)}</time>
					</header>
					{#if m.kind === 'roll' && m.audience}
						<span class="private">Secret roll · {privacy(m.audience)}</span>
					{/if}
					{#if m.kind === 'chat'}
						<p class="text">{m.text}</p>
					{:else}
						<p class="roll-result">
							<span class="expr">{m.roll.expression}</span>
							<span class="breakdown">
								{#each m.roll.terms as t, i (i)}
									{#if t.sign === -1}
										<span class="op">−</span>
									{:else if i > 0}
										<span class="op">+</span>
									{/if}
									{#if t.kind === 'dice'}
										{#each t.rolls as r, j (j)}
											<span
												class="die num"
												class:max={r === t.sides}
												class:min={r === 1}
												title={`d${t.sides}`}>{r}</span
											>
										{/each}
									{:else}
										<span class="flat">{t.value}</span>
									{/if}
								{/each}
							</span>
							<span class="total num">{m.roll.total}</span>
						</p>
					{/if}
				{/if}
			</li>
		{/each}
	</ol>

	<div class="dice-bar" role="group" aria-label="Quick roll">
		{#each STANDARD_DICE as sides (sides)}
			<button type="button" onclick={() => send({ type: 'dice_roll', expression: `1d${sides}` })}>
				d{sides}
			</button>
		{/each}
	</div>

	<form onsubmit={submit}>
		<input
			bind:value={draft}
			maxlength={CHAT_MAX_LENGTH}
			placeholder="Message, or /roll 2d6+3"
			title="/roll 2d6+3 rolls for everyone to see; /gmroll rolls for you and the GM only"
			aria-label="Chat message"
			autocomplete="off"
		/>
		<button type="submit" disabled={!draft.trim()}>Send</button>
	</form>
</section>

<style>
	.chat {
		display: flex;
		flex-direction: column;
		gap: var(--sp-4);
		height: 100%;
		min-height: 0;
	}

	.log {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		list-style: none;
		margin: 0;
		padding: 0 var(--sp-2) 0 0;
		display: flex;
		flex-direction: column;
		gap: var(--sp-4);
		overflow-wrap: anywhere;
	}

	li.system {
		color: var(--muted);
		font-size: var(--fs-sm);
		font-style: italic;
	}

	li.narration {
		font-family: var(--font-display);
		font-style: italic;
		line-height: 1.4;
	}

	.speaker {
		display: block;
		font-style: normal;
		font-size: var(--fs-sm);
		font-weight: 700;
		font-variant: small-caps;
		letter-spacing: 0.04em;
		color: var(--accent);
	}

	.versus {
		color: var(--muted);
		font-size: var(--fs-sm);
	}

	.verdict {
		font-weight: 700;
		color: var(--danger);
	}

	.verdict.hit {
		color: var(--ok);
	}

	li.attack .total {
		margin-left: 0;
	}

	.damage {
		font-size: var(--fs-md);
	}

	.outcome {
		margin: var(--sp-2) 0 0;
		font-weight: 700;
	}

	header {
		display: flex;
		gap: var(--sp-4);
		align-items: baseline;
	}

	.author {
		font-weight: 700;
		font-size: var(--fs-sm);
	}

	.mine .author {
		color: var(--accent);
	}

	time {
		color: var(--muted);
		font-size: var(--fs-2xs);
		font-variant-numeric: tabular-nums;
	}

	.text {
		margin: 0;
	}

	.roll-result {
		margin: var(--sp-1) 0 0;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--sp-3);
		padding: var(--sp-3) var(--sp-4);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		background: var(--panel-sunk);
	}

	.private {
		display: block;
		margin-top: var(--sp-2);
		font-style: normal;
		font-size: var(--fs-2xs);
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--accent);
	}

	.expr {
		font-family: var(--font-mono);
		color: var(--muted);
		font-size: var(--fs-sm);
	}

	.breakdown {
		display: inline-flex;
		flex-wrap: wrap;
		gap: var(--sp-2);
		font-family: var(--font-mono);
		font-size: var(--fs-sm);
	}

	.op {
		color: var(--muted);
	}

	.die {
		min-width: 1.5rem;
		padding: 0 var(--sp-2);
		text-align: center;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--panel-raised);
	}

	.max {
		color: var(--ok);
		font-weight: 700;
	}

	.min {
		color: var(--danger);
		font-weight: 700;
	}

	.total {
		margin-left: auto;
		font-size: var(--fs-lg);
		font-weight: 700;
		color: var(--accent);
	}

	.dice-bar {
		display: flex;
		flex-wrap: wrap;
		gap: var(--sp-2);
	}

	.dice-bar button {
		padding: var(--sp-2) var(--sp-4);
		font-size: var(--fs-xs);
		font-family: var(--font-mono);
	}

	form {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: var(--sp-3);
	}
</style>
