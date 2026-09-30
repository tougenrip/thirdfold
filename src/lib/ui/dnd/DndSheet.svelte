<script lang="ts">
	import type { CharacterStatus, GearChange } from '$lib/adventure/adventure';
	import type { RoomAction } from '$lib/net/room-connection.svelte';
	import type { DndSheetDetails } from '$lib/rules/dnd55e/sheet';

	interface Props {
		status: CharacterStatus;
		details: DndSheetDetails;
		send(action: RoomAction): boolean;
		/** The others in play, to hand things to. */
		party?: { id: string; name: string }[];
		/** The GM may hand out gear from the catalog. */
		gm?: boolean;
	}

	let { status, details, send, party = [], gm = false }: Props = $props();

	const card = $derived(status.card);
	const signed = (n: number) => `${n >= 0 ? '+' : ''}${n}`;
	const expertise = $derived(new Set(details.choices.expertise));
	const save = (id: string) => card.saves.find((s) => s.id === id);
	const groups = $derived(
		['Species', 'Class', 'Subclass'].map((from) => ({
			from,
			features: details.features.filter((f) => f.from === from)
		}))
	);

	function mark(resource: string, spent: number) {
		send({
			type: 'adventure_sheet',
			characterId: status.id,
			edit: { kind: 'resource', resource, spent }
		});
	}

	let draft = $state<string | null>(null);
	const notes = $derived(draft ?? status.notes ?? '');
	const unsaved = $derived(draft !== null && draft !== (status.notes ?? ''));
	function saveNotes() {
		if (draft === null) return;
		send({ type: 'adventure_sheet', characterId: status.id, edit: { kind: 'notes', text: draft } });
		draft = null;
	}

	// Gear: what the character owns, live from the card; each change goes to the server, which checks it.
	const inventory = $derived(card.inventory ?? []);
	const gear = (change: GearChange) =>
		send({ type: 'adventure_gear', characterId: status.id, change });
	let amounts = $state<Record<string, number>>({});
	const amountOf = (id: string, max: number) => Math.min(max, Math.max(1, amounts[id] ?? max));
	let giveTo = $state<Record<string, string>>({});
	let granting = $state('');
	let grantCount = $state(1);

	let renaming = $state<string | null>(null);
	function rename() {
		const name = renaming?.trim();
		renaming = null;
		if (name && name !== status.def.name)
			send({ type: 'adventure_sheet', characterId: status.id, edit: { kind: 'name', name } });
	}
</script>

<div class="dnd">
	<p class="legend">
		<span class="tag now">Now</span> changes as you play ·
		<span class="tag rules">Rules</span> worked out by the table ·
		<span class="tag chosen">Chosen</span> made when the character was created
	</p>

	{#if status.renamable}
		<div class="rename">
			{#if renaming === null}
				<button type="button" class="ghost" onclick={() => (renaming = status.def.name)}
					>Rename</button
				>
			{:else}
				<label class="field">
					<span>New name</span>
					<input
						type="text"
						maxlength="40"
						bind:value={renaming}
						onkeydown={(e) => e.key === 'Enter' && rename()}
					/>
				</label>
				<button type="button" class="primary" onclick={rename}>Save name</button>
				<button type="button" class="ghost" onclick={() => (renaming = null)}>Cancel</button>
			{/if}
		</div>
	{/if}

	<section aria-labelledby="dnd-conditions">
		<h3 id="dnd-conditions" class="section-title"><span class="tag now">Now</span> Conditions</h3>
		{#if status.conditions.length || status.effects.length || status.concentrating}
			{#each status.conditions as c (c.effect + c.id)}
				<details>
					<summary>
						<b>{c.name}{c.level ? ` ${c.level}` : ''}</b>
						<small class="muted">{c.until} · {c.from}</small>
					</summary>
					{#each c.text.split('\n\n') as para, i (i)}<p>{para}</p>{/each}
					{#if c.notPlayed.length}<p class="off">Not played yet: {c.notPlayed.join('; ')}.</p>{/if}
				</details>
			{/each}
			{#each status.effects as line (line)}
				<p class="effect">{line}</p>
			{/each}
			{#if status.concentrating}
				<p class="muted">
					Concentrating on {status.concentrating}: damage calls for a Constitution save to keep it,
					and falling or being Incapacitated ends it.
				</p>
			{/if}
		{:else}
			<p class="muted">No conditions.</p>
		{/if}
	</section>

	<section aria-labelledby="dnd-now">
		<h3 id="dnd-now" class="section-title"><span class="tag now">Now</span> Resources</h3>
		{#if card.resources?.length}
			<ul class="resources">
				{#each card.resources as r (r.id)}
					{@const spent = status.resourcesSpent[r.id] ?? 0}
					<li>
						<span class="name">{r.name}</span>
						<span class="pips" aria-label="{r.max - spent} of {r.max} left">
							{#each Array.from({ length: r.max }, (_, i) => i) as i (i)}
								<span class="pip" class:used={i >= r.max - spent}></span>
							{/each}
						</span>
						<span class="num">{r.max - spent}/{r.max}</span>
						{#if r.trackedBy}
							<small>counted as you use it</small>
						{:else if status.editable}
							<button
								type="button"
								class="ghost"
								disabled={spent >= r.max}
								aria-label="Use one {r.name}"
								onclick={() => mark(r.id, spent + 1)}>Use</button
							>
							<button
								type="button"
								class="ghost"
								disabled={spent === 0}
								aria-label="Get one {r.name} back"
								onclick={() => mark(r.id, spent - 1)}>Regain</button
							>
						{/if}
					</li>
				{/each}
			</ul>
		{:else}
			<p class="muted">No limited resources at this level.</p>
		{/if}
		<p class="muted">Hit Point Dice: {details.derived.hitDice}d{details.derived.hitDie}.</p>
	</section>

	<section aria-labelledby="dnd-gear-now">
		<h3 id="dnd-gear-now" class="section-title"><span class="tag now">Now</span> Gear</h3>
		{#if card.carrying}
			<p class="muted num">
				Carrying {card.carrying.weight} of {card.carrying.capacity} lb.
			</p>
		{/if}
		{#if inventory.length}
			<ul class="gear">
				{#each inventory as i (i.id)}
					<li>
						<div class="what">
							<b>{i.quantity > 1 || i.kind === 'Ammunition' ? `${i.quantity} ` : ''}{i.name}</b>
							{#if i.equipped}<span class="tag worn">{i.equipped}</span>{/if}
							<small>{i.kind} · {i.weight} lb. · {i.source}</small>
						</div>
						{#if status.editable}
							<div class="do">
								{#if i.equippable}
									<button
										type="button"
										class="ghost"
										onclick={() => gear({ kind: i.equipped ? 'unequip' : 'equip', item: i.id })}
										>{i.equipped
											? i.kind.includes('weapon')
												? 'Put away'
												: 'Take off'
											: i.kind.includes('weapon')
												? 'Take up'
												: 'Put on'}</button
									>
								{/if}
								{#if i.quantity > 1}
									<input
										class="count num"
										type="number"
										min="1"
										max={i.quantity}
										aria-label="How many"
										value={amountOf(i.id, i.quantity)}
										oninput={(e) => (amounts[i.id] = Number(e.currentTarget.value))}
									/>
								{/if}
								<button
									type="button"
									class="ghost"
									disabled={i.quantity < 1}
									onclick={() =>
										gear({ kind: 'drop', item: i.id, quantity: amountOf(i.id, i.quantity) })}
									>Put down</button
								>
								{#if party.length && i.quantity > 0}
									<select
										aria-label="Give {i.name} to"
										value={giveTo[i.id] ?? ''}
										onchange={(e) => {
											const to = e.currentTarget.value;
											if (to)
												gear({
													kind: 'give',
													item: i.id,
													quantity: amountOf(i.id, i.quantity),
													to
												});
											giveTo[i.id] = '';
										}}
									>
										<option value="">Give to…</option>
										{#each party as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
									</select>
								{/if}
							</div>
						{/if}
					</li>
				{/each}
			</ul>
		{:else}
			<p class="muted">Carrying nothing.</p>
		{/if}
		{#if status.editable}
			<p class="muted">
				In a fight, on your turn, you may take up or put away a weapon, put something down or hand
				it over, twice; armor stays as it is. Handing over and picking up need the other beside you.
			</p>
		{/if}
		{#if gm}
			<div class="grant">
				<label class="field">
					<span>Give from the SRD</span>
					<select bind:value={granting}>
						<option value="">Choose…</option>
						{#each ['weapon', 'armor', 'Shield', 'Ammunition'] as group (group)}
							<optgroup
								label={group === 'weapon' ? 'Weapons' : group === 'armor' ? 'Armor' : group}
							>
								{#each details.gear.filter( (g) => (group === 'weapon' ? g.kind.endsWith('weapon') : group === 'armor' ? g.kind.endsWith('armor') : g.kind === group) ) as g (g.id)}
									<option value={g.id}>{g.name}</option>
								{/each}
							</optgroup>
						{/each}
					</select>
				</label>
				<label class="field small">
					<span>How many</span>
					<input type="number" min="1" max="999" bind:value={grantCount} />
				</label>
				<button
					type="button"
					class="primary"
					disabled={!granting}
					onclick={() => {
						gear({ kind: 'grant', item: granting, quantity: Math.max(1, grantCount || 1) });
						granting = '';
						grantCount = 1;
					}}>Give</button
				>
			</div>
		{/if}
	</section>

	<section aria-labelledby="dnd-rules">
		<h3 id="dnd-rules" class="section-title"><span class="tag rules">Rules</span> At a glance</h3>
		<dl class="glance num">
			<div>
				<dt>Initiative</dt>
				<dd>{signed(details.derived.initiative)}</dd>
			</div>
			<div>
				<dt>Passive Perception</dt>
				<dd>{details.derived.passivePerception}</dd>
			</div>
			{#if details.spellcasting}
				<div>
					<dt>Spell save DC</dt>
					<dd>{details.spellcasting.saveDc}</dd>
				</div>
				<div>
					<dt>Spell attack</dt>
					<dd>{signed(details.spellcasting.attackBonus)}</dd>
				</div>
			{/if}
		</dl>
		{#if details.spellcasting}
			<p class="muted">
				Casts with {details.spellcasting.ability}: {details.spellcasting.cantrips} cantrips and
				{details.spellcasting.prepared} prepared spells at this level. Casting a spell spends a slot above;
				until rests come to the table, mark slots regained by hand.
			</p>
		{/if}
	</section>

	{#if details.spellcasting?.spells?.length}
		<section aria-labelledby="dnd-spells">
			<h3 id="dnd-spells" class="section-title"><span class="tag rules">Rules</span> Spells</h3>
			{#each details.spellcasting.spells as sp (sp.id)}
				<details>
					<summary>
						{sp.name}
						<small class="muted"
							>{sp.level ? `Level ${sp.level}` : 'Cantrip'} · {sp.school}{sp.concentration
								? ' · Concentration'
								: ''}</small
						>
						{#if !sp.action}<small class="off">Not cast at the table</small>{/if}
					</summary>
					<p class="muted">
						{sp.castingTime} · {sp.range} · {sp.components} · {sp.duration}
					</p>
					{#if sp.why}<p class="off">{sp.why}</p>{/if}
					{#each sp.text.split('\n\n') as para, i (i)}<p>{para}</p>{/each}
				</details>
			{/each}
			<p class="muted">Material components aren’t tracked at the table.</p>
		</section>
	{/if}

	<section aria-labelledby="dnd-abilities">
		<h3 id="dnd-abilities" class="section-title">
			<span class="tag rules">Rules</span> Abilities and saving throws
		</h3>
		<table class="abilities num">
			<thead>
				<tr
					><th scope="col">Ability</th><th scope="col">Score</th><th scope="col">Mod</th><th
						scope="col">Save</th
					></tr
				>
			</thead>
			<tbody>
				{#each card.stats as a (a.id)}
					{@const base = details.choices.base.find((b) => b.id === a.id)}
					{@const s = save(a.id)}
					<tr>
						<th scope="row">{a.name}</th>
						<td
							>{a.score}{#if base && base.increase}<small>
									({base.score} + {base.increase})</small
								>{/if}</td
						>
						<td>{signed(a.bonus)}</td>
						<td class:proficient={s?.proficient}
							>{s ? signed(s.bonus) : ''}{s?.proficient ? ' ●' : ''}</td
						>
					</tr>
				{/each}
			</tbody>
		</table>
		<p class="muted">
			● proficient: your proficiency bonus ({signed(card.proficiency ?? 0)}) counts.
		</p>
	</section>

	<section aria-labelledby="dnd-skills">
		<h3 id="dnd-skills" class="section-title"><span class="tag rules">Rules</span> Skills</h3>
		<ul class="skills num">
			{#each card.skills as s (s.id)}
				<li class:proficient={s.proficient}>
					<span>{s.name}</span>
					<b>{signed(s.bonus)}</b>
					{#if expertise.has(s.name)}<small>Expertise</small>{:else if s.proficient}<small
							>Proficient</small
						>{/if}
				</li>
			{/each}
		</ul>
	</section>

	<section aria-labelledby="dnd-features">
		<h3 id="dnd-features" class="section-title">
			<span class="tag rules">Rules</span> Features and feats
		</h3>
		{#each groups as g (g.from)}
			{#if g.features.length}
				<h4>
					{g.from === 'Species'
						? details.choices.species
						: g.from === 'Class'
							? details.choices.class
							: details.choices.subclass}
				</h4>
				{#each g.features as f (f.from + f.name)}
					<details>
						<summary>{f.name}{f.level ? ` (level ${f.level})` : ''}</summary>
						<p>{f.text}</p>
					</details>
				{/each}
			{/if}
		{/each}
		{#if details.feats.length}
			<h4>Feats</h4>
			{#each details.feats as f (f.name)}
				<details>
					<summary>{f.name}</summary>
					<p>{f.text}</p>
				</details>
			{/each}
		{/if}
	</section>

	<section aria-labelledby="dnd-gear">
		<h3 id="dnd-gear" class="section-title">
			<span class="tag rules">Rules</span> Weapons and training
		</h3>
		<p>
			Wearing {details.equipment.armor ?? 'no armor'}{details.equipment.shield
				? ' and a Shield'
				: ''}.
		</p>
		<ul class="plain">
			{#each details.equipment.weapons as w (`${w.name}:${w.held}`)}
				<li>
					<b>{w.name}</b>{w.held ? ' (in hand)' : ''}: {w.damage}{w.properties.length
						? ` (${w.properties.join(', ')})`
						: ''}.
					{#if w.mastered}Mastery: {w.mastery}.{/if}
					{#if !w.trained}<em>Not trained with it: no Proficiency Bonus.</em>{/if}
				</li>
			{/each}
		</ul>
		<p class="muted">
			Armor training: {details.proficiencies.armor.length
				? details.proficiencies.armor.join(', ')
				: 'none'}. Weapons: {details.proficiencies.weapons}.
			{#if details.proficiencies.tools.length}Tools: {details.proficiencies.tools.join('; ')}.{/if}
		</p>
	</section>

	<section aria-labelledby="dnd-choices">
		<h3 id="dnd-choices" class="section-title">
			<span class="tag chosen">Chosen</span> Who they are
		</h3>
		<dl class="choices">
			<div>
				<dt>Species</dt>
				<dd>
					{details.choices.species}{#each details.choices.speciesOptions as o (o.label)}; {o.label}:
						{o.value}{/each}
				</dd>
			</div>
			<div>
				<dt>Background</dt>
				<dd>{details.choices.background}</dd>
			</div>
			<div>
				<dt>Class</dt>
				<dd>
					{details.choices.class}
					{details.choices.level}{details.choices.subclass ? ` (${details.choices.subclass})` : ''}
				</dd>
			</div>
			<div>
				<dt>Ability scores</dt>
				<dd>{details.choices.scores}</dd>
			</div>
			<div>
				<dt>Class skills</dt>
				<dd>{details.choices.skills.join(', ') || 'none'}</dd>
			</div>
			{#if details.choices.expertise.length}
				<div>
					<dt>Expertise</dt>
					<dd>{details.choices.expertise.join(', ')}</dd>
				</div>
			{/if}
			{#if details.choices.fightingStyle}
				<div>
					<dt>Fighting Style</dt>
					<dd>{details.choices.fightingStyle}</dd>
				</div>
			{/if}
			{#if details.choices.weaponMasteries.length}
				<div>
					<dt>Weapon Mastery</dt>
					<dd>{details.choices.weaponMasteries.join(', ')}</dd>
				</div>
			{/if}
			{#each details.choices.kept as k (k.name)}
				<div>
					<dt>{k.name}</dt>
					<dd>{k.value}</dd>
				</div>
			{/each}
		</dl>
	</section>

	{#if status.notes !== null}
		<section aria-labelledby="dnd-notes">
			<h3 id="dnd-notes" class="section-title"><span class="tag now">Now</span> Notes</h3>
			<p class="muted">Only this character's player and the GM see these.</p>
			<textarea
				rows="4"
				maxlength="2000"
				aria-labelledby="dnd-notes"
				value={notes}
				oninput={(e) => (draft = e.currentTarget.value)}></textarea>
			<button type="button" class="primary" disabled={!unsaved} onclick={saveNotes}
				>{unsaved ? 'Save notes' : 'Saved'}</button
			>
		</section>
	{/if}
</div>

<style>
	.dnd {
		display: grid;
		gap: var(--sp-5);
	}

	section {
		display: grid;
		gap: var(--sp-2);
	}

	h3 {
		display: flex;
		align-items: center;
		gap: var(--sp-2);
		margin: 0;
	}

	h4 {
		margin: var(--sp-2) 0 0;
		font-size: var(--fs-sm);
	}

	p {
		margin: 0;
	}

	.legend,
	.muted,
	small {
		color: var(--muted);
		font-size: var(--fs-xs);
	}

	.tag {
		display: inline-block;
		padding: 0 var(--sp-2);
		border-radius: var(--radius-pill);
		font-size: var(--fs-xs);
		font-weight: 600;
		border: 1px solid currentColor;
	}

	.tag.now {
		color: var(--ok);
	}

	.tag.rules {
		color: var(--accent);
	}

	.tag.chosen {
		color: var(--muted);
	}

	.rename {
		display: flex;
		flex-wrap: wrap;
		align-items: end;
		gap: var(--sp-3);
	}

	.field {
		display: grid;
		gap: var(--sp-1);
		font-size: var(--fs-sm);
	}

	.resources,
	.skills,
	.plain {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: var(--sp-2);
	}

	.resources li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--sp-3);
		font-size: var(--fs-sm);
	}

	.resources .name {
		min-width: 10rem;
	}

	.resources button {
		padding: var(--sp-1) var(--sp-3);
		font-size: var(--fs-xs);
	}

	.pips {
		display: flex;
		gap: var(--sp-1);
	}

	.pip {
		width: 0.75rem;
		height: 0.75rem;
		border-radius: 50%;
		background: var(--accent);
		border: 1px solid var(--accent);
	}

	.pip.used {
		background: transparent;
		border-color: var(--border-strong);
	}

	.glance {
		display: flex;
		flex-wrap: wrap;
		gap: var(--sp-5);
		margin: 0;
	}

	.glance dt {
		color: var(--muted);
		font-size: var(--fs-xs);
	}

	.glance dd {
		margin: 0;
		font-size: var(--fs-lg);
		font-weight: 600;
	}

	.abilities {
		width: 100%;
		border-collapse: collapse;
		font-size: var(--fs-sm);
	}

	.abilities th,
	.abilities td {
		padding: var(--sp-1) var(--sp-2);
		text-align: left;
		border-bottom: 1px solid var(--border);
	}

	.abilities thead th {
		color: var(--muted);
		font-weight: 500;
		font-size: var(--fs-xs);
	}

	td.proficient {
		font-weight: 600;
	}

	.skills {
		grid-template-columns: repeat(auto-fill, minmax(13rem, 1fr));
		font-size: var(--fs-sm);
	}

	.skills li {
		display: flex;
		gap: var(--sp-2);
		align-items: baseline;
		color: var(--muted);
	}

	.skills li.proficient {
		color: var(--text);
	}

	.skills span {
		flex: 1;
	}

	details p {
		margin: var(--sp-1) 0 var(--sp-2);
		color: var(--muted);
		font-size: var(--fs-sm);
		white-space: pre-line;
	}

	summary {
		font-size: var(--fs-sm);
		cursor: pointer;
	}

	summary small {
		margin-left: var(--sp-2);
		font-size: var(--fs-2xs);
	}

	.off {
		color: var(--warn, var(--accent));
	}

	.effect {
		margin: 0;
		font-size: var(--fs-sm);
	}

	.choices {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
		gap: var(--sp-3);
		margin: 0;
		font-size: var(--fs-sm);
	}

	.choices dt {
		color: var(--muted);
		font-size: var(--fs-xs);
	}

	.choices dd {
		margin: 0;
	}

	textarea {
		width: 100%;
		font: inherit;
		font-size: var(--fs-sm);
	}

	section > button {
		justify-self: start;
	}

	.gear {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: var(--sp-2);
	}

	.gear li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--sp-2) var(--sp-3);
		padding-bottom: var(--sp-2);
		border-bottom: 1px solid var(--border);
		font-size: var(--fs-sm);
	}

	.gear .what {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: var(--sp-1) var(--sp-2);
		min-width: 0;
	}

	.gear .what small {
		flex-basis: 100%;
	}

	.tag.worn {
		color: var(--accent);
	}

	.gear .do,
	.grant {
		display: flex;
		flex-wrap: wrap;
		align-items: end;
		gap: var(--sp-2);
	}

	.gear button,
	.gear select {
		padding: var(--sp-1) var(--sp-3);
		font-size: var(--fs-xs);
	}

	.count {
		width: 4.5rem;
		font-size: var(--fs-xs);
	}

	.field.small input {
		width: 5rem;
	}
</style>
