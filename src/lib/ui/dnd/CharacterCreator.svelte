<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import type {
		AbilityId,
		CreatorOptions,
		CreatorPreview,
		CreatorSummary
	} from '$lib/rules/dnd55e/creator';
	import type { CreatorReply, RoomAction } from '$lib/net/room-connection.svelte';
	import {
		ABILITY_IDS,
		complete,
		emptyDraft,
		loadDraft,
		originSkills,
		pointBuyBase,
		pointsSpent,
		saveDraft,
		STEPS,
		todo,
		toChoices,
		toggle,
		unplaced,
		withBackground,
		withClass,
		withSpecies,
		type Draft,
		type StepId
	} from './creator-draft';

	interface Props {
		roomId: string;
		reply: CreatorReply | null;
		send(action: RoomAction): boolean;
		onClose(): void;
	}

	let { roomId, reply, send, onClose }: Props = $props();

	let options = $state<CreatorOptions | null>(null);
	let preview = $state<CreatorPreview | null>(null);
	let draft = $state<Draft>(untrack(() => loadDraft(roomId)) ?? emptyDraft());
	let building = $state(false);
	let lastPreview = '';

	onMount(() => {
		send({ type: 'character_options' });
	});

	$effect(() => {
		if (!reply) return;
		if (reply.type === 'character_options' && reply.rules === 'dnd-5.5e')
			options = reply.options as unknown as CreatorOptions;
		if (reply.type === 'character_preview') preview = reply.preview as CreatorPreview;
	});

	// Keep the draft as the player goes, so a refresh or a dropped connection picks up here.
	$effect(() => {
		saveDraft(roomId, $state.snapshot(draft) as Draft);
	});

	const klass = $derived(options?.classes.find((c) => c.id === draft.classId) ?? null);
	const species = $derived(options?.species.find((s) => s.id === draft.speciesId) ?? null);
	const background = $derived(
		options?.backgrounds.find((b) => b.id === draft.backgroundId) ?? null
	);
	const stepIndex = $derived(STEPS.findIndex((s) => s.id === draft.step));
	const left = $derived(options ? todo(draft, options, draft.step) : []);
	const ready = $derived(!!options && complete(draft, options));
	const known = $derived(options ? originSkills(draft, options) : []);
	const proficient = $derived([...known, ...draft.skills]);
	const skillName = (id: string) => options?.skills.find((s) => s.id === id)?.name ?? id;
	const abilityName = (id: AbilityId) => options?.abilities.find((a) => a.id === id)?.name ?? id;
	const weapon = (id: string) => options?.weapons.find((w) => w.id === id);
	const trained = $derived(
		(klass?.trainedWeapons ?? []).map((id) => weapon(id)!).filter((w) => !!w)
	);
	const signed = (n: number) => (n < 0 ? `${n}` : `+${n}`);

	// On the review step, ask the server what the finished choices come to.
	$effect(() => {
		if (draft.step !== 'review' || !options || !ready) return;
		const choices = JSON.stringify(toChoices(draft, options));
		if (choices === lastPreview) return;
		lastPreview = choices;
		const timer = setTimeout(
			() => send({ type: 'character_preview', choices: JSON.parse(choices) }),
			250
		);
		return () => clearTimeout(timer);
	});

	const go = (step: StepId) => (draft.step = step);
	const next = () => {
		const n = STEPS[stepIndex + 1];
		if (n) go(n.id);
	};
	const back = () => {
		const p = STEPS[stepIndex - 1];
		if (p) go(p.id);
	};

	function setMethod(method: Draft['method']) {
		if (draft.method === method) return;
		draft.method = method;
		draft.base =
			method === 'point-buy'
				? pointBuyBase()
				: { str: null, dex: null, con: null, int: null, wis: null, cha: null };
	}

	function bump(a: AbilityId, by: number) {
		if (!options) return;
		const next = (draft.base[a] ?? 8) + by;
		if (options.pointCost[String(next)] === undefined) return;
		draft.base = { ...draft.base, [a]: next };
	}

	function create() {
		if (!options || !ready) return;
		building = true;
		send({
			type: 'adventure_build',
			choices: JSON.parse(JSON.stringify(toChoices(draft, options)))
		});
	}

	// Once built, the table takes over: the draft is done with.
	$effect(() => () => {
		if (building) saveDraft(roomId, null);
	});

	const summary = $derived(preview?.ok ? (preview.summary as CreatorSummary) : null);
</script>

<div class="backdrop">
	<section class="creator" aria-labelledby="creator-title">
		<header>
			<h2 id="creator-title">Create your character</h2>
			<p class="help">
				A level 1 character by the fifth edition rules. Choose one thing at a time; the table checks
				every choice and works out the numbers. Your choices are kept if you leave and come back.
			</p>
			<ol class="steps">
				{#each STEPS as step, i (step.id)}
					<li>
						<button
							type="button"
							class:current={step.id === draft.step}
							class:done={!!options && todo(draft, options, step.id).length === 0}
							aria-current={step.id === draft.step ? 'step' : undefined}
							onclick={() => go(step.id)}>{i + 1}. {step.title}</button
						>
					</li>
				{/each}
			</ol>
		</header>

		{#if !options}
			<p class="help">Getting the choices from the table…</p>
		{:else if draft.step === 'class'}
			<fieldset>
				<legend>Class</legend>
				<div class="cards">
					{#each options.classes as c (c.id)}
						<label class="card" class:chosen={draft.classId === c.id}>
							<input
								type="radio"
								name="class"
								checked={draft.classId === c.id}
								onchange={() => (draft = withClass(draft, c.id))}
							/>
							<span class="name">{c.name}</span>
							<span class="meta">d{c.hitDie} hit die · {c.primary}</span>
							<span class="meta"
								>Saves: {c.saves.map(abilityName).join(', ')} · Armor: {c.armor.length
									? c.armor.join(', ')
									: 'none'}</span
							>
						</label>
					{/each}
				</div>
				{#if klass}
					<div class="details">
						<h3>{klass.name} at level 1</h3>
						<p class="meta">Weapons: {klass.weapons}</p>
						{#each klass.features as f (f.name)}
							<details>
								<summary>{f.name}</summary>
								<p>{f.text}</p>
							</details>
						{/each}
					</div>
				{/if}
			</fieldset>
		{:else if draft.step === 'origin'}
			<fieldset>
				<legend>Species</legend>
				<div class="cards">
					{#each options.species as s (s.id)}
						<label class="card" class:chosen={draft.speciesId === s.id}>
							<input
								type="radio"
								name="species"
								checked={draft.speciesId === s.id}
								onchange={() => (draft = withSpecies(draft, s.id))}
							/>
							<span class="name">{s.name}</span>
							<span class="meta">Speed {s.speed} ft.</span>
						</label>
					{/each}
				</div>
				{#if species}
					<div class="details">
						{#each species.traits as t (t.name)}
							<details>
								<summary>{t.name}</summary>
								<p>{t.text}</p>
							</details>
						{/each}
						{#each species.options as o (o.key)}
							<label class="field">
								<span>{o.label}</span>
								<select
									value={draft.speciesOptions[o.key] ?? ''}
									onchange={(e) =>
										(draft.speciesOptions = {
											...draft.speciesOptions,
											[o.key]: e.currentTarget.value
										})}
								>
									<option value="" disabled>Choose…</option>
									{#each o.values as v (v.id)}
										<option value={v.id}>{v.name}</option>
									{/each}
								</select>
							</label>
						{/each}
						{#if species.feat}
							<label class="field">
								<span>Origin feat (Versatile)</span>
								<select
									value={draft.speciesFeat ?? ''}
									onchange={(e) => {
										draft.speciesFeat = e.currentTarget.value;
										draft.speciesFeatSkills = [];
									}}
								>
									<option value="" disabled>Choose…</option>
									{#each options.originFeats as f (f.id)}
										<option value={f.id}>{f.name}</option>
									{/each}
								</select>
							</label>
							{@const feat = options.originFeats.find((f) => f.id === draft.speciesFeat)}
							{#if feat}
								<p class="rules">{feat.text}</p>
								{#if feat.skills}
									<div class="checks" role="group" aria-label="{feat.name} skills">
										{#each options.skills as s (s.id)}
											<label
												><input
													type="checkbox"
													checked={draft.speciesFeatSkills.includes(s.id)}
													onchange={() =>
														(draft.speciesFeatSkills = toggle(
															draft.speciesFeatSkills,
															s.id,
															feat.skills
														))}
												/>
												{s.name}</label
											>
										{/each}
									</div>
								{/if}
							{/if}
						{/if}
					</div>
				{/if}
			</fieldset>
			<fieldset>
				<legend>Background</legend>
				<div class="cards">
					{#each options.backgrounds as b (b.id)}
						<label class="card" class:chosen={draft.backgroundId === b.id}>
							<input
								type="radio"
								name="background"
								checked={draft.backgroundId === b.id}
								onchange={() => (draft = withBackground(draft, b.id))}
							/>
							<span class="name">{b.name}</span>
							<span class="meta">Skills: {b.skills.map(skillName).join(', ')}</span>
							<span class="meta">Feat: {b.feat}</span>
						</label>
					{/each}
				</div>
				{#if background}
					<div class="details">
						<p class="rules">{background.featText}</p>
						<div class="checks" role="radiogroup" aria-label="Ability increases">
							<label
								><input
									type="radio"
									name="increase"
									checked={draft.increaseMode === 'two'}
									onchange={() => (draft.increaseMode = 'two')}
								/> +2 to one, +1 to another</label
							>
							<label
								><input
									type="radio"
									name="increase"
									checked={draft.increaseMode === 'three'}
									onchange={() => (draft.increaseMode = 'three')}
								/>
								+1 to all three ({background.abilities.map(abilityName).join(', ')})</label
							>
						</div>
						{#if draft.increaseMode === 'two'}
							<div class="row">
								<label class="field">
									<span>+2</span>
									<select
										value={draft.plusTwo ?? ''}
										onchange={(e) => (draft.plusTwo = e.currentTarget.value as AbilityId)}
									>
										<option value="" disabled>Choose…</option>
										{#each background.abilities as a (a)}
											<option value={a}>{abilityName(a)}</option>
										{/each}
									</select>
								</label>
								<label class="field">
									<span>+1</span>
									<select
										value={draft.plusOne ?? ''}
										onchange={(e) => (draft.plusOne = e.currentTarget.value as AbilityId)}
									>
										<option value="" disabled>Choose…</option>
										{#each background.abilities.filter((a) => a !== draft.plusTwo) as a (a)}
											<option value={a}>{abilityName(a)}</option>
										{/each}
									</select>
								</label>
							</div>
						{/if}
					</div>
				{/if}
			</fieldset>
		{:else if draft.step === 'abilities'}
			<fieldset>
				<legend>Ability scores</legend>
				<div class="checks" role="radiogroup" aria-label="How to set the scores">
					<label
						><input
							type="radio"
							name="method"
							checked={draft.method === 'standard-array'}
							onchange={() => setMethod('standard-array')}
						/>
						Standard array ({options.standardArray.join(', ')})</label
					>
					<label
						><input
							type="radio"
							name="method"
							checked={draft.method === 'point-buy'}
							onchange={() => setMethod('point-buy')}
						/>
						Point buy ({options.points} points)</label
					>
				</div>
				{#if klass}<p class="meta">A {klass.name} relies most on {klass.primary}.</p>{/if}
				<div class="scores">
					{#each ABILITY_IDS as a (a)}
						<div class="score">
							<span class="name">{abilityName(a)}</span>
							{#if draft.method === 'standard-array'}
								<select
									aria-label={abilityName(a)}
									value={draft.base[a] === null ? '' : String(draft.base[a])}
									onchange={(e) =>
										(draft.base = {
											...draft.base,
											[a]: e.currentTarget.value ? Number(e.currentTarget.value) : null
										})}
								>
									<option value="">–</option>
									{#each [...new Set( [...unplaced(draft, options), ...(draft.base[a] === null ? [] : [draft.base[a]])] )].sort((x, y) => (y ?? 0) - (x ?? 0)) as v (v)}
										<option value={String(v)}>{v}</option>
									{/each}
								</select>
							{:else}
								<span class="buy">
									<button
										type="button"
										aria-label="Lower {abilityName(a)}"
										onclick={() => bump(a, -1)}>−</button
									>
									<b class="num">{draft.base[a]}</b>
									<button
										type="button"
										aria-label="Raise {abilityName(a)}"
										onclick={() => bump(a, 1)}>+</button
									>
								</span>
							{/if}
						</div>
					{/each}
				</div>
				{#if draft.method === 'point-buy'}
					<p class="meta num">
						{options.points - pointsSpent(draft, options)} of {options.points} points left
					</p>
				{/if}
				<p class="meta">
					Your background's increases are added on top; the review shows the totals.
				</p>
			</fieldset>
		{:else if draft.step === 'skills'}
			{#if !klass}
				<p class="help">Choose a class first.</p>
			{:else}
				<fieldset>
					<legend>Class skills ({draft.skills.length} of {klass.skills.count})</legend>
					{#if known.length}
						<p class="meta">Already yours: {known.map(skillName).join(', ')}.</p>
					{/if}
					<div class="checks">
						{#each options.skills.filter((s) => !klass.skills.from || klass.skills.from.includes(s.id)) as s (s.id)}
							<label
								><input
									type="checkbox"
									disabled={known.includes(s.id)}
									checked={draft.skills.includes(s.id)}
									onchange={() => {
										draft.skills = toggle(draft.skills, s.id, klass.skills.count);
										draft.expertise = draft.expertise.filter((x) =>
											[...known, ...draft.skills].includes(x)
										);
									}}
								/>
								{s.name}</label
							>
						{/each}
					</div>
				</fieldset>
				{#if klass.expertise}
					<fieldset>
						<legend>Expertise ({draft.expertise.length} of {klass.expertise})</legend>
						<div class="checks">
							{#each proficient as id (id)}
								<label
									><input
										type="checkbox"
										checked={draft.expertise.includes(id)}
										onchange={() =>
											(draft.expertise = toggle(draft.expertise, id, klass.expertise))}
									/>
									{skillName(id)}</label
								>
							{/each}
						</div>
					</fieldset>
				{/if}
				{#if klass.fightingStyle}
					<fieldset>
						<legend>Fighting Style</legend>
						{#each options.fightingStyles as f (f.id)}
							<label class="option"
								><input
									type="radio"
									name="style"
									checked={draft.fightingStyle === f.id}
									onchange={() => (draft.fightingStyle = f.id)}
								/>
								<b>{f.name}</b> <span class="rules">{f.text}</span></label
							>
						{/each}
					</fieldset>
				{/if}
				{#if klass.weaponMastery.count}
					<fieldset>
						<legend>Weapon Mastery ({draft.masteries.length} of {klass.weaponMastery.count})</legend
						>
						<div class="checks">
							{#each trained.filter((w) => !klass.weaponMastery.melee || w.type === 'melee') as w (w.id)}
								<label
									><input
										type="checkbox"
										checked={draft.masteries.includes(w.id)}
										onchange={() =>
											(draft.masteries = toggle(draft.masteries, w.id, klass.weaponMastery.count))}
									/>
									{w.name} <span class="meta">({w.mastery})</span></label
								>
							{/each}
						</div>
					</fieldset>
				{/if}
			{/if}
		{:else if draft.step === 'spells'}
			{#if !klass}
				<p class="help">Choose a class first.</p>
			{:else if !klass.spells}
				<p class="help">A {klass.name} casts no spells at level 1. Carry on.</p>
			{:else}
				{@const spells = klass.spells}
				<p class="help">
					Spells marked “not at the table yet” can still be chosen; they are on the sheet, and play
					when the table comes to them.
				</p>
				{#each [{ level: 0, max: spells.cantrips, key: 'cantrips' as const, title: 'Cantrips' }, { level: 1, max: spells.prepared, key: 'prepared' as const, title: 'Prepared spells' }] as group (group.key)}
					{#if group.max}
						<fieldset>
							<legend>{group.title} ({draft[group.key].length} of {group.max})</legend>
							{#each spells.list.filter( (sp) => (group.level === 0 ? sp.level === 0 : sp.level > 0) ) as sp (sp.id)}
								<label class="option"
									><input
										type="checkbox"
										checked={draft[group.key].includes(sp.id)}
										onchange={() => (draft[group.key] = toggle(draft[group.key], sp.id, group.max))}
									/>
									<b>{sp.name}</b>
									<span class="meta"
										>{sp.level ? `Level ${sp.level} ` : ''}{sp.school} · {sp.castingTime} · {sp.range}{sp.concentration
											? ' · Concentration'
											: ''}{sp.why ? ' · not at the table yet' : ''}{sp.homebrew
											? ` · Homebrew: ${sp.homebrew}`
											: ''}</span
									>
									<span class="rules">{sp.text}</span></label
								>
							{/each}
						</fieldset>
					{/if}
				{/each}
			{/if}
		{:else if draft.step === 'gear'}
			{#if !klass}
				<p class="help">Choose a class first.</p>
			{:else}
				<fieldset>
					<legend>Armor</legend>
					<label class="field">
						<span>Worn</span>
						<select
							value={draft.armor ?? ''}
							onchange={(e) => (draft.armor = e.currentTarget.value || null)}
						>
							<option value="">No armor</option>
							{#each options.armor.filter((a) => a.category !== 'shield' && klass.armor.includes(a.category)) as a (a.id)}
								<option value={a.id}
									>{a.name} (AC {a.armorClass}{a.strength
										? `, Strength ${a.strength}`
										: ''}){a.homebrew ? ` · Homebrew: ${a.homebrew}` : ''}</option
								>
							{/each}
						</select>
					</label>
					{#if klass.armor.includes('shield')}
						<label
							><input type="checkbox" bind:checked={draft.shield} /> A Shield (+2 Armor Class)</label
						>
					{/if}
				</fieldset>
				<fieldset>
					<legend>Weapons ({draft.weapons.length} of up to {options.weaponsMax})</legend>
					<div class="checks">
						{#each trained as w (w.id)}
							<label
								><input
									type="checkbox"
									checked={draft.weapons.includes(w.id)}
									onchange={() =>
										(draft.weapons = toggle(draft.weapons, w.id, options!.weaponsMax))}
								/>
								{w.name}
								<span class="meta"
									>{w.damage}
									{w.damageType.toLowerCase()}{w.homebrew ? ` · Homebrew: ${w.homebrew}` : ''}</span
								></label
							>
						{/each}
					</div>
				</fieldset>
			{/if}
		{:else}
			<fieldset>
				<legend>Name and colour</legend>
				<label class="field">
					<span>Name</span>
					<input type="text" maxlength="40" bind:value={draft.name} />
				</label>
				<div class="swatches" role="radiogroup" aria-label="Colour">
					{#each options.colors as c (c)}
						<button
							type="button"
							class="swatch"
							role="radio"
							aria-checked={draft.color === c}
							aria-label={c}
							style:--swatch={c}
							onclick={() => (draft.color = c)}
						></button>
					{/each}
				</div>
			</fieldset>
			{#if !ready}
				<div class="todo">
					<p>Still to choose:</p>
					<ul>
						{#each STEPS as s (s.id)}
							{#each todo(draft, options, s.id) as t (t)}
								<li>
									<button type="button" class="link" onclick={() => go(s.id)}>{s.title}</button>: {t}
								</li>
							{/each}
						{/each}
					</ul>
				</div>
			{:else if preview && !preview.ok}
				<div class="todo" role="alert">
					<p>The rules don't allow this yet:</p>
					<ul>
						{#each preview.problems as p (p)}<li>{p}</li>{/each}
					</ul>
				</div>
			{:else if summary}
				<div class="summary">
					<h3>{draft.name || 'Your character'}: {summary.title}</h3>
					<dl class="vitals num">
						<div>
							<dt>HP</dt>
							<dd>{summary.hp}</dd>
						</div>
						<div>
							<dt>Armor Class</dt>
							<dd>{summary.armorClass}</dd>
						</div>
						<div>
							<dt>Speed</dt>
							<dd>{summary.speed} ft.</dd>
						</div>
						<div>
							<dt>Initiative</dt>
							<dd>{signed(summary.initiative)}</dd>
						</div>
						<div>
							<dt>Proficiency</dt>
							<dd>{signed(summary.proficiency)}</dd>
						</div>
					</dl>
					<p class="num">
						{#each summary.scores as s, i (s.id)}{i ? ' · ' : ''}{s.name}
							{s.score} ({signed(s.modifier)}){/each}
					</p>
					<p>
						Skills: {summary.skills
							.filter((s) => s.proficient)
							.map((s) => `${s.name} ${signed(s.bonus)}${s.expertise ? ' (Expertise)' : ''}`)
							.join(', ')}
					</p>
					<ul>
						{#each summary.actions as a (a.name)}<li><b>{a.name}</b>: {a.summary}</li>{/each}
					</ul>
					<p class="meta">
						Features: {summary.features.join(', ')}. Feats: {summary.feats.join(', ')}.
					</p>
					{#if summary.spellcasting}
						<p class="meta">
							Spell save DC {summary.spellcasting.saveDc}, spell attack {signed(
								summary.spellcasting.attackBonus
							)}. Spells come to the table later; for now this character fights with its weapons.
						</p>
					{/if}
				</div>
			{:else}
				<p class="help">Asking the table what this comes to…</p>
			{/if}
		{/if}

		{#if options && draft.step !== 'review' && left.length}
			<p class="meta" aria-live="polite">{left.join(' ')}</p>
		{/if}

		<footer>
			<button type="button" class="ghost" onclick={onClose}>Back to the characters</button>
			<span class="spacer"></span>
			{#if stepIndex > 0}<button type="button" onclick={back}>Back</button>{/if}
			{#if draft.step !== 'review'}
				<button type="button" class="primary" disabled={left.length > 0} onclick={next}>Next</button
				>
			{:else}
				<button
					type="button"
					class="primary"
					disabled={!ready || !summary || building}
					onclick={create}>{building ? 'Creating…' : 'Create and play'}</button
				>
			{/if}
		</footer>
		{#if options}<p class="attribution">{options.attribution}</p>{/if}
	</section>
</div>

<style>
	.backdrop {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		padding: 5rem var(--sp-6) var(--sp-6);
		background: var(--scrim);
		overflow-y: auto;
	}

	.creator {
		width: min(56rem, 100%);
		display: grid;
		gap: var(--sp-5);
		padding: var(--sp-7);
		background: var(--panel-solid);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-lg);
	}

	h2 {
		margin: 0;
		font-size: var(--fs-xl);
	}

	h3 {
		margin: 0 0 var(--sp-2);
		font-size: var(--fs-md);
	}

	.help,
	.meta,
	.rules,
	.attribution {
		margin: 0;
		color: var(--muted);
		font-size: var(--fs-sm);
		max-width: 70ch;
	}

	.attribution {
		font-size: var(--fs-xs);
	}

	.steps {
		display: flex;
		flex-wrap: wrap;
		gap: var(--sp-2);
		margin: var(--sp-4) 0 0;
		padding: 0;
		list-style: none;
	}

	.steps button {
		font-size: var(--fs-sm);
		padding: var(--sp-1) var(--sp-3);
		border-radius: var(--radius-md);
		border: 1px solid var(--border);
		background: none;
		color: var(--muted);
	}

	.steps button.done {
		color: var(--text);
	}

	.steps button.current {
		border-color: var(--accent);
		color: var(--text);
		font-weight: 600;
	}

	fieldset {
		display: grid;
		gap: var(--sp-3);
		margin: 0;
		padding: var(--sp-4);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
	}

	legend {
		padding: 0 var(--sp-2);
		font-weight: 600;
	}

	.cards {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr));
		gap: var(--sp-3);
	}

	.card {
		display: grid;
		gap: var(--sp-1);
		padding: var(--sp-3);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		cursor: pointer;
	}

	.card.chosen {
		border-color: var(--accent);
		box-shadow: 0 0 0 1px var(--accent);
	}

	.card input {
		position: absolute;
		opacity: 0;
		pointer-events: none;
	}

	.card:focus-within {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}

	.name {
		font-weight: 600;
	}

	.details {
		display: grid;
		gap: var(--sp-2);
	}

	details p {
		margin: var(--sp-1) 0 0;
		color: var(--muted);
		font-size: var(--fs-sm);
		white-space: pre-line;
	}

	.field {
		display: grid;
		gap: var(--sp-1);
		max-width: 22rem;
		font-size: var(--fs-sm);
	}

	.row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--sp-4);
	}

	.checks {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr));
		gap: var(--sp-2);
		font-size: var(--fs-sm);
	}

	.option {
		display: block;
		font-size: var(--fs-sm);
	}

	.scores {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr));
		gap: var(--sp-3);
	}

	.score {
		display: grid;
		gap: var(--sp-1);
	}

	.buy {
		display: flex;
		align-items: center;
		gap: var(--sp-2);
	}

	.buy button {
		width: 2rem;
	}

	.swatches {
		display: flex;
		gap: var(--sp-2);
	}

	.swatch {
		width: 2rem;
		height: 2rem;
		border-radius: 50%;
		background: var(--swatch);
		border: 2px solid var(--border);
	}

	.swatch[aria-checked='true'] {
		border-color: var(--text);
		box-shadow: 0 0 0 2px var(--accent);
	}

	.todo ul,
	.summary ul {
		margin: var(--sp-1) 0 0;
		padding-left: var(--sp-5);
	}

	.todo p,
	.summary p {
		margin: 0 0 var(--sp-1);
	}

	.link {
		padding: 0;
		border: 0;
		background: none;
		color: var(--accent);
		text-decoration: underline;
	}

	.vitals {
		display: flex;
		flex-wrap: wrap;
		gap: var(--sp-5);
		margin: 0 0 var(--sp-3);
	}

	.vitals dt {
		color: var(--muted);
		font-size: var(--fs-xs);
	}

	.vitals dd {
		margin: 0;
		font-size: var(--fs-lg);
		font-weight: 600;
	}

	footer {
		display: flex;
		align-items: center;
		gap: var(--sp-3);
	}

	.spacer {
		flex: 1;
	}
</style>
