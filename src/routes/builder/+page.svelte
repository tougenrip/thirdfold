<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { EVIDENCE_KINDS, OBJECT_STATES, type ObjectState } from '$lib/adventure/adventure';
	import { CHARACTERS, CHARACTER_IDS, STATS } from '$lib/adventure/characters';
	import type { ObjectDef } from '$lib/adventure/define';
	import { exampleAdventure } from '$lib/adventure/example';
	import {
		ADVENTURE_FILE_FORMAT,
		ADVENTURE_FILE_MAX_BYTES,
		ADVENTURE_FILE_VERSION,
		loadAdventureFile,
		parseAdventureFile
	} from '$lib/adventure/file';
	import { loadManifest } from '$lib/assets/load';
	import { NAME_MAX_LENGTH } from '$lib/game/protocol';
	import { parseSceneFile, SCENE_FILE_MAX_BYTES } from '$lib/game/scene-file';
	import CellsInput from '$lib/builder/CellsInput.svelte';
	import {
		flowOf,
		formatArea,
		formatCell,
		idFrom,
		idsOf,
		loadDraft,
		toDraft,
		type Draft,
		newTable,
		parseArea,
		parseCell,
		renameKey,
		storeDraft
	} from '$lib/builder/draft';
	import EffectsEditor from '$lib/builder/EffectsEditor.svelte';
	import ListInput from '$lib/builder/ListInput.svelte';
	import RulesEditor from '$lib/builder/RulesEditor.svelte';
	import WhenEditor from '$lib/builder/WhenEditor.svelte';
	import { handOff, RoomConnection } from '$lib/net/room-connection.svelte';
	import { loadGmKey, loadName, saveName } from '$lib/prefs';

	let draft = $state<Draft>(loadDraft());

	// Kept in this browser as it is edited (a moment after each change).
	$effect(() => {
		const snapshot = $state.snapshot(draft) as Draft;
		const timer = setTimeout(() => storeDraft(snapshot), 400);
		return () => clearTimeout(timer);
	});

	/** Everything wrong with the draft, checked the way the server will check it. */
	const checked = $derived(loadAdventureFile($state.snapshot(draft), 'draft'));
	const problems = $derived(
		checked.ok ? [] : (checked.problems ?? [checked.error.replace(/^[^:]*: /, '')])
	);
	const ids = $derived(idsOf(draft));
	const flow = $derived(flowOf(draft));
	const rewards = $derived.by(() => {
		const found: string[] = [];
		JSON.stringify(draft, (k, v) => {
			if (k === 'reward' && typeof v === 'string' && v && !found.includes(v)) found.push(v);
			return v;
		});
		return found;
	});

	const SECTIONS = [
		['overview', 'Overview'],
		['scenes', 'Scenes'],
		['flow', 'Flow'],
		['people', 'People'],
		['fights', 'Fights'],
		['things', 'Things & triggers'],
		['choices', 'Choices & endings'],
		['check', 'Check'],
		['json', 'File']
	] as const;
	let section = $state<(typeof SECTIONS)[number][0]>('overview');

	let models = $state<{ npc: string[]; enemy: string[]; environments: [string, string][] }>({
		npc: [],
		enemy: [],
		environments: []
	});
	$effect(() => {
		void loadManifest().then((m) => {
			const of = (kind: string) =>
				Object.entries(m.models)
					.filter(([, x]) => x.kind === kind)
					.map(([id]) => id);
			models = {
				npc: of('npc'),
				enemy: of('enemy'),
				environments: Object.entries(m.environments).map(([id, e]) => [id, e.name])
			};
		});
	});

	let error = $state<string | null>(null);
	let notice = $state<string | null>(null);

	// ---------------------------------------------------------------------
	// Files

	function exportFile() {
		const blob = new Blob([JSON.stringify($state.snapshot(draft), null, 2)], {
			type: 'application/json'
		});
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `${idFrom(draft.title)}.thirdfold-adventure.json`;
		a.click();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}

	async function readJson(file: File, max: number): Promise<unknown> {
		if (file.size > max) throw new Error('That file is too large.');
		try {
			return JSON.parse(await file.text());
		} catch {
			throw new Error('That file is not JSON.');
		}
	}

	async function importFile(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		try {
			const parsed = parseAdventureFile(await readJson(file, ADVENTURE_FILE_MAX_BYTES));
			if (!parsed.ok) throw new Error(`That is not a thirdfold adventure: ${parsed.error}.`);
			draft = toDraft(parsed.file);
			error = null;
			notice = `Opened “${parsed.file.title}”.`;
		} catch (err) {
			error = (err as Error).message;
		}
	}

	/** Brings a table built and exported at a table (Scene panel → Export file) into a location. */
	async function importTable(location: string, event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		try {
			const parsed = parseSceneFile(await readJson(file, SCENE_FILE_MAX_BYTES));
			if (!parsed.ok) throw new Error(`That is not a thirdfold table: ${parsed.error}`);
			draft.locations[location].scene = { ...parsed.scene, adventure: null, discovery: {} };
			error = null;
			notice = `The ${draft.locations[location].name} table is now “${parsed.scene.name}”.`;
		} catch (err) {
			error = (err as Error).message;
		}
	}

	function startOver() {
		if (!confirm('Start over from the example adventure? This draft will be replaced.')) return;
		draft = toDraft(exampleAdventure());
	}

	function blank() {
		if (!confirm('Start a new, empty adventure? This draft will be replaced.')) return;
		draft = {
			format: ADVENTURE_FILE_FORMAT,
			version: ADVENTURE_FILE_VERSION,
			title: 'A new adventure',
			about: '',
			characters: [...CHARACTER_IDS],
			start: { location: 'start', chapter: 'beginning', arrival: [] },
			locations: {
				start: {
					name: 'The start',
					welcome: 'Where it begins.',
					spawn: [
						{ x: 1, y: 1 },
						{ x: 2, y: 1 }
					],
					scene: newTable('The start')
				}
			},
			areas: [],
			chapters: {
				beginning: {
					title: 'The beginning',
					location: 'start',
					objectives: [{ id: 'finish', text: 'See it through', done: 'finished' }],
					next: { on: 'finished', to: null }
				}
			},
			events: { finished: { label: 'It is finished' } },
			decisions: {
				end: {
					prompt: 'How does it end?',
					options: [{ id: 'well', label: 'Well', does: [{ event: 'finished' }] }]
				}
			},
			endings: {
				decision: 'end',
				fallback: 'well',
				names: { good: { title: 'The End' } },
				byAnswer: {
					well: {
						ending: 'good',
						subtitle: 'It ended well',
						headline: 'It ended well',
						text: 'And so it ended.',
						scene: 'The table, quiet.',
						cue: 'flash',
						result: []
					}
				}
			},
			npcs: {},
			peoplePlaces: [],
			reactions: [],
			objects: [],
			signs: [],
			clues: {},
			mechanisms: {},
			enemies: {},
			encounters: {},
			cues: []
		};
	}

	// ---------------------------------------------------------------------
	// Play it

	let playName = $state(loadName());
	let playing = $state(false);

	/** Opens a new table as its GM and starts this adventure there. */
	async function play() {
		const name = playName.trim();
		if (!name) return (error = 'Enter your name to play it.');
		if (!checked.ok) return (error = 'Fix the problems first (see Check).');
		error = null;
		playing = true;
		saveName(name);
		const gmKey = loadGmKey();
		const conn = new RoomConnection({ type: 'create', name, ...(gmKey ? { gmKey } : {}) });
		try {
			await conn.ready();
			conn.send({ type: 'adventure_start', file: $state.snapshot(draft) });
			for (let i = 0; i < 100 && !conn.room?.adventure && !conn.actionError; i++) {
				await new Promise((r) => setTimeout(r, 50));
			}
			if (conn.actionError) throw new Error(conn.actionError.message);
			if (!conn.room?.adventure) throw new Error('The table did not start the adventure.');
			handOff(conn);
			await goto(resolve('/room/[id]', { id: conn.room.id }));
		} catch (err) {
			conn.close();
			error = (err as Error).message;
		} finally {
			playing = false;
		}
	}

	// ---------------------------------------------------------------------
	// Editing helpers

	function rename<K extends keyof Draft>(part: K, from: string, raw: string) {
		const to = raw.trim();
		if (!/^[a-z0-9][a-z0-9_-]{0,47}$/.test(to)) {
			error = 'Ids are lower case letters, digits, - and _.';
			return;
		}
		draft[part] = renameKey(draft[part] as Record<string, unknown>, from, to) as Draft[K];
	}

	function remove<K extends keyof Draft>(part: K, key: string) {
		const next = { ...(draft[part] as Record<string, unknown>) };
		delete next[key];
		draft[part] = next as Draft[K];
	}

	function add<R extends Record<string, unknown>>(record: R, name: string, value: R[string]) {
		(record as Record<string, unknown>)[idFrom(name, Object.keys(record))] = value;
	}

	function moveChapter(key: string, by: number) {
		const entries = Object.entries(draft.chapters);
		const i = entries.findIndex(([k]) => k === key);
		const [item] = entries.splice(i, 1);
		entries.splice(Math.max(0, Math.min(entries.length, i + by)), 0, item);
		draft.chapters = Object.fromEntries(entries);
	}

	const cellValue = (c: { x: number; y: number }) => formatCell(c);
	const setCell = (raw: string, apply: (c: { x: number; y: number }) => void) => {
		const c = parseCell(raw);
		if (c) apply(c);
	};
	const setArea = (
		raw: string,
		apply: (a: { from: { x: number; y: number }; to: { x: number; y: number } }) => void
	) => {
		const a = parseArea(raw);
		if (a) apply(a);
	};
	const propsOf = (location: string) =>
		draft.locations[location]?.scene.props.map((p) => p.id) ?? [];
	const thingOf = (o: ObjectDef) =>
		'prop' in o.thing ? 'prop' : 'door' in o.thing ? 'door' : 'token';
	const toggle = (list: string[], item: string, on: boolean) =>
		on ? [...new Set([...list, item])] : list.filter((x) => x !== item);

	// The whole file, as text, for what the forms don't cover.
	let jsonText = $state('');
	$effect(() => {
		if (section === 'json') jsonText = JSON.stringify($state.snapshot(draft), null, 2);
	});

	function applyJson() {
		let raw: unknown;
		try {
			raw = JSON.parse(jsonText);
		} catch {
			error = 'That is not valid JSON.';
			return;
		}
		const parsed = parseAdventureFile(raw);
		if (!parsed.ok) {
			error = `That is not a valid adventure file: ${parsed.error}.`;
			return;
		}
		draft = toDraft(parsed.file);
		error = null;
		notice = 'Applied.';
	}
</script>

<svelte:head>
	<title>Adventure builder · thirdfold</title>
</svelte:head>

{#snippet datalist(id: string, items: readonly string[])}
	<datalist {id}>
		{#each items as item (item)}<option value={item}></option>{/each}
	</datalist>
{/snippet}
{@render datalist('ids-events', ids.events)}
{@render datalist('ids-clues', ids.clues)}
{@render datalist('ids-chapters', ids.chapters)}
{@render datalist('ids-objects', ids.objects)}
{@render datalist('ids-npcs', ids.npcs)}
{@render datalist('ids-decisions', ids.decisions)}
{@render datalist('ids-encounters', ids.encounters)}
{@render datalist('ids-locations', ids.locations)}
{@render datalist('ids-enemies', ids.enemies)}

<div class="builder">
	<header>
		<a class="home" href={resolve('/')}>thirdfold</a>
		<h1>Adventure builder</h1>
		<span class="spacer"></span>
		<button type="button" onclick={blank}>New</button>
		<button type="button" onclick={startOver}>Example</button>
		<label class="file-button">
			Open file
			<input type="file" accept=".json,application/json" hidden onchange={importFile} />
		</label>
		<button type="button" onclick={exportFile}>Save file</button>
		<input
			class="name"
			aria-label="Your name"
			placeholder="Your name"
			maxlength={NAME_MAX_LENGTH}
			bind:value={playName}
		/>
		<button class="primary" type="button" disabled={playing} onclick={play}>
			{playing ? 'Opening…' : 'Play it'}
		</button>
	</header>

	{#if error}<p class="error" role="alert">{error}</p>{/if}
	{#if notice && !error}<p class="notice" role="status">{notice}</p>{/if}

	<nav aria-label="Parts of the adventure">
		{#each SECTIONS as [id, label] (id)}
			<button
				type="button"
				aria-current={section === id ? 'page' : undefined}
				onclick={() => (section = id)}
			>
				{label}{#if id === 'check'}
					<span class="badge" class:ok={problems.length === 0}>{problems.length || '✓'}</span>
				{/if}
			</button>
		{/each}
	</nav>

	<main>
		{#if section === 'overview'}
			<section>
				<h2>Overview</h2>
				<label class="field">
					<span>Title</span>
					<input bind:value={draft.title} maxlength="80" />
				</label>
				<label class="field">
					<span>About (for whoever picks it)</span>
					<textarea rows="2" bind:value={draft.about} maxlength="600"></textarea>
				</label>
				<fieldset>
					<legend>Characters players choose from</legend>
					{#each CHARACTER_IDS as c (c)}
						<label class="check">
							<input
								type="checkbox"
								checked={draft.characters.includes(c)}
								onchange={(e) =>
									(draft.characters = toggle(draft.characters, c, e.currentTarget.checked))}
							/>
							{CHARACTERS[c].name} <span class="muted">{CHARACTERS[c].tagline}</span>
						</label>
					{/each}
				</fieldset>
				<div class="grid2">
					<label class="field">
						<span>It starts at</span>
						<select bind:value={draft.start.location}>
							{#each ids.locations as l (l)}<option value={l}>{draft.locations[l].name}</option
								>{/each}
						</select>
					</label>
					<label class="field">
						<span>In the chapter</span>
						<select bind:value={draft.start.chapter}>
							{#each ids.chapters as c (c)}<option value={c}>{draft.chapters[c].title}</option
								>{/each}
						</select>
					</label>
				</div>
				<h3>When the GM begins</h3>
				<EffectsEditor bind:effects={draft.start.arrival} label="Arrival" />
				<h3>Read-aloud passages for the GM</h3>
				{#each draft.cues as cue, i (i)}
					<div class="card">
						<div class="grid2">
							<input aria-label="Passage id" bind:value={cue.id} />
							<input aria-label="Passage title" bind:value={cue.title} />
						</div>
						<textarea aria-label="Passage text" rows="2" bind:value={cue.text}></textarea>
						<button
							type="button"
							onclick={() => (draft.cues = draft.cues.filter((_, j) => j !== i))}>Remove</button
						>
					</div>
				{/each}
				<button
					type="button"
					onclick={() =>
						draft.cues.push({
							id: idFrom(
								'passage',
								draft.cues.map((c) => c.id)
							),
							title: 'A passage',
							text: '…'
						})}
				>
					Add a passage
				</button>
			</section>
		{:else if section === 'scenes'}
			<section>
				<h2>Scenes</h2>
				<p class="muted">
					Each place is a table. Build one at a table (Scene panel: New table, floors, walls, props,
					lights), export it with Export file, and bring it in here.
				</p>
				{#each Object.entries(draft.locations) as [key, loc] (key)}
					<div class="card">
						<div class="grid3">
							<label class="field">
								<span>Id</span>
								<input
									value={key}
									onchange={(e) => rename('locations', key, e.currentTarget.value)}
								/>
							</label>
							<label class="field">
								<span>Name</span>
								<input bind:value={loc.name} />
							</label>
							<label class="field">
								<span>Party appears at</span>
								<CellsInput label="Spawn cells" bind:value={loc.spawn} />
							</label>
						</div>
						<label class="field">
							<span>Welcome (for a player joining here)</span>
							<input bind:value={loc.welcome} />
						</label>
						<p class="table-info">
							Table: <strong>{loc.scene.name}</strong>, {loc.scene.grid.width}×{loc.scene.grid
								.height},
							{loc.scene.props.length} props, {loc.scene.objects.length} walls and doors, {loc.scene
								.lights.length}
							lights{loc.scene.environment ? `, ${loc.scene.environment}` : ''}.
							{#if loc.scene.props.length}<span class="muted"
									>Props: {loc.scene.props.map((p) => p.id).join(', ')}</span
								>{/if}
						</p>
						<div class="row">
							<label class="file-button">
								Bring in a table file
								<input
									type="file"
									accept=".json,application/json"
									hidden
									onchange={(e) => importTable(key, e)}
								/>
							</label>
							<button
								type="button"
								onclick={() =>
									(loc.scene = newTable(
										loc.name,
										loc.scene.grid.width,
										loc.scene.grid.height,
										loc.scene.environment
									))}
							>
								Empty table
							</button>
							<button type="button" class="danger" onclick={() => remove('locations', key)}
								>Remove place</button
							>
						</div>
					</div>
				{/each}
				<button
					type="button"
					onclick={() =>
						add(draft.locations, 'place', {
							name: 'A new place',
							welcome: 'A new place.',
							spawn: [{ x: 1, y: 1 }],
							scene: newTable('A new place')
						})}
				>
					Add a place
				</button>
			</section>
		{:else if section === 'flow'}
			<section>
				<h2>Flow</h2>
				<ol class="flow" aria-label="How the story moves">
					{#each flow as step, i (i)}
						<li class:branch={step.kind === 'branch'}>
							<strong>{draft.chapters[step.from]?.title ?? step.from}</strong>
							→ <em>{step.by}</em> →
							<strong
								>{step.to === null
									? 'the ending'
									: (draft.chapters[step.to]?.title ?? step.to)}</strong
							>
						</li>
					{/each}
				</ol>
				<h3>Chapters, in order</h3>
				{#each Object.entries(draft.chapters) as [key, ch], n (key)}
					<details class="card" open={n === 0}>
						<summary>
							<strong>{n + 1}. {ch.title}</strong>
							<span class="muted">at {draft.locations[ch.location]?.name ?? ch.location}</span>
						</summary>
						<div class="grid3">
							<label class="field">
								<span>Id</span>
								<input
									value={key}
									onchange={(e) => rename('chapters', key, e.currentTarget.value)}
								/>
							</label>
							<label class="field">
								<span>Title</span>
								<input bind:value={ch.title} />
							</label>
							<label class="field">
								<span>Played at</span>
								<select bind:value={ch.location}>
									{#each ids.locations as l (l)}<option value={l}>{draft.locations[l].name}</option
										>{/each}
								</select>
							</label>
						</div>
						<h4>Objectives</h4>
						{#each ch.objectives as o, i (i)}
							<div class="objective">
								<input aria-label="Objective" bind:value={o.text} />
								<input
									aria-label="Done when (event)"
									list="ids-events"
									placeholder="done when (event)"
									bind:value={o.done}
								/>
								<input
									aria-label="Shown after (event)"
									list="ids-events"
									placeholder="shown after (event)"
									value={o.after ?? ''}
									onchange={(e) => {
										const v = e.currentTarget.value.trim();
										if (v) o.after = v;
										else delete o.after;
									}}
								/>
								<label class="check">
									<input
										type="checkbox"
										checked={!!o.optional}
										onchange={(e) => {
											if (e.currentTarget.checked) o.optional = true;
											else delete o.optional;
										}}
									/> optional
								</label>
								<button
									type="button"
									aria-label="Remove objective"
									onclick={() => ch.objectives.splice(i, 1)}>×</button
								>
							</div>
						{/each}
						<button
							type="button"
							onclick={() =>
								ch.objectives.push({
									id: idFrom(
										'objective',
										ch.objectives.map((o) => o.id)
									),
									text: 'Something to do',
									done: ids.events[0] ?? ''
								})}
						>
							Add an objective
						</button>
						<h4>Moves on</h4>
						<div class="grid2">
							<label class="field">
								<span>When this happens</span>
								<input list="ids-events" bind:value={ch.next.on} />
							</label>
							<label class="field">
								<span>To</span>
								<select
									value={ch.next.to ?? ''}
									onchange={(e) => (ch.next.to = e.currentTarget.value || null)}
								>
									<option value="">The ending</option>
									{#each ids.chapters as c (c)}<option value={c}>{draft.chapters[c].title}</option
										>{/each}
								</select>
							</label>
						</div>
						<h4>As the party enters it</h4>
						<EffectsEditor
							bind:effects={() => ch.opening ?? [], (e) => (ch.opening = e)}
							label="Opening"
						/>
						<div class="row">
							<button type="button" onclick={() => moveChapter(key, -1)}>Earlier</button>
							<button type="button" onclick={() => moveChapter(key, 1)}>Later</button>
							<button type="button" class="danger" onclick={() => remove('chapters', key)}
								>Remove chapter</button
							>
						</div>
					</details>
				{/each}
				<button
					type="button"
					onclick={() =>
						add(draft.chapters, 'chapter', {
							title: 'A new chapter',
							location: ids.locations[0] ?? '',
							objectives: [],
							next: { on: ids.events[0] ?? '', to: null }
						})}
				>
					Add a chapter
				</button>
				<h3>Events</h3>
				<p class="muted">What can happen in the story; each can change the table when it does.</p>
				{#each Object.entries(draft.events) as [key, ev] (key)}
					<details class="card">
						<summary><code>{key}</code> {ev.label}</summary>
						<div class="grid2">
							<label class="field">
								<span>Id</span>
								<input value={key} onchange={(e) => rename('events', key, e.currentTarget.value)} />
							</label>
							<label class="field">
								<span>Label (for the GM)</span>
								<input bind:value={ev.label} />
							</label>
						</div>
						<EffectsEditor
							bind:effects={() => ev.does ?? [], (e) => (ev.does = e)}
							label="When it happens"
						/>
						<button type="button" class="danger" onclick={() => remove('events', key)}
							>Remove event</button
						>
					</details>
				{/each}
				<button
					type="button"
					onclick={() => add(draft.events, 'event', { label: 'Something happened' })}
					>Add an event</button
				>
			</section>
		{:else if section === 'people'}
			<section>
				<h2>People</h2>
				{#each Object.entries(draft.npcs) as [key, npc] (key)}
					<details class="card">
						<summary><strong>{npc.name}</strong> <span class="muted">{npc.role}</span></summary>
						<div class="grid3">
							<label class="field"
								><span>Id</span><input
									value={key}
									onchange={(e) => rename('npcs', key, e.currentTarget.value)}
								/></label
							>
							<label class="field"><span>Name</span><input bind:value={npc.name} /></label>
							<label class="field"
								><span>Speaker label</span><input bind:value={npc.speaker} /></label
							>
							<label class="field"
								><span>Who they are (for the GM)</span><input bind:value={npc.role} /></label
							>
							<label class="field">
								<span>Where</span>
								<select bind:value={npc.location}>
									{#each ids.locations as l (l)}<option value={l}>{draft.locations[l].name}</option
										>{/each}
								</select>
							</label>
							<label class="field">
								<span>Stands at</span>
								<input
									value={cellValue(npc.places.calm)}
									onchange={(e) => setCell(e.currentTarget.value, (c) => (npc.places.calm = c))}
								/>
							</label>
							<label class="field">
								<span>Figure</span>
								<select bind:value={npc.model}>
									{#each models.npc as m (m)}<option value={m}>{m}</option>{/each}
								</select>
							</label>
							<label class="field"
								><span>Colour</span><input type="color" bind:value={npc.color} /></label
							>
							<label class="field">
								<span>States (the first is where they start)</span>
								<ListInput
									label="States"
									bind:value={() => npc.states, (v) => (npc.states = [...(v ?? [])])}
								/>
							</label>
						</div>
						<h4>Dialogue: the first line that applies is said</h4>
						{#each npc.lines as line, i (i)}
							<div class="line">
								<div class="grid3">
									<input aria-label="Line id" bind:value={line.id} />
									<label class="check">
										<input
											type="checkbox"
											checked={!!line.once}
											onchange={(e) =>
												e.currentTarget.checked ? (line.once = true) : delete line.once}
										/> once
									</label>
									<label class="check">
										<input
											type="checkbox"
											checked={!!line.narrated}
											onchange={(e) =>
												e.currentTarget.checked ? (line.narrated = true) : delete line.narrated}
										/> told by the narrator
									</label>
								</div>
								<textarea aria-label="What they say" rows="2" bind:value={line.text}></textarea>
								<details>
									<summary>When</summary>
									<WhenEditor bind:when={line.if} />
								</details>
								<div class="grid3">
									<input
										aria-label="Gives the clue"
										list="ids-clues"
										placeholder="gives the clue"
										value={line.clue ?? ''}
										onchange={(e) =>
											e.currentTarget.value.trim()
												? (line.clue = e.currentTarget.value.trim())
												: delete line.clue}
									/>
									<input
										aria-label="Makes happen"
										list="ids-events"
										placeholder="makes an event happen"
										value={line.event ?? ''}
										onchange={(e) =>
											e.currentTarget.value.trim()
												? (line.event = e.currentTarget.value.trim())
												: delete line.event}
									/>
									<input
										aria-label="Becomes"
										placeholder="they become (a state)"
										value={line.becomes ?? ''}
										onchange={(e) =>
											e.currentTarget.value.trim()
												? (line.becomes = e.currentTarget.value.trim())
												: delete line.becomes}
									/>
								</div>
								<button type="button" onclick={() => npc.lines.splice(i, 1)}>Remove line</button>
							</div>
						{/each}
						<button
							type="button"
							onclick={() =>
								npc.lines.push({
									id: idFrom(
										'line',
										npc.lines.map((l) => l.id)
									),
									text: '…'
								})}>Add a line</button
						>
						<button type="button" class="danger" onclick={() => remove('npcs', key)}
							>Remove person</button
						>
					</details>
				{/each}
				<button
					type="button"
					onclick={() =>
						add(draft.npcs, 'person', {
							name: 'Someone',
							role: 'Someone who lives here',
							speaker: 'Someone',
							color: '#b08850',
							model: models.npc[0] ?? 'villager',
							location: ids.locations[0] ?? '',
							home: 'Here',
							places: { calm: { x: 2, y: 2 } },
							states: ['calm'],
							lines: [{ id: 'hello', text: 'Hello.' }]
						})}
				>
					Add a person
				</button>
				<h3>Reactions</h3>
				<p class="muted">
					A line someone calls out once, when something is done nearby (<code>object:verb</code>) or
					happens (<code>event:id</code>).
				</p>
				{#each draft.reactions as r, i (i)}
					<div class="objective">
						<input aria-label="Who" list="ids-npcs" bind:value={r.npc} />
						<input aria-label="On" placeholder="sack:search or event:asked" bind:value={r.on} />
						<input aria-label="What they call out" bind:value={r.text} />
						<button
							type="button"
							aria-label="Remove reaction"
							onclick={() => draft.reactions.splice(i, 1)}>×</button
						>
					</div>
				{/each}
				<button
					type="button"
					onclick={() =>
						draft.reactions.push({
							id: idFrom(
								'reaction',
								draft.reactions.map((r) => r.id)
							),
							npc: ids.npcs[0] ?? '',
							on: `event:${ids.events[0] ?? ''}`,
							text: '…'
						})}
				>
					Add a reaction
				</button>
			</section>
		{:else if section === 'fights'}
			<section>
				<h2>Enemies</h2>
				{#each Object.entries(draft.enemies) as [key, en] (key)}
					<details class="card">
						<summary><strong>{en.name}</strong> <span class="muted">{en.behavior}</span></summary>
						<div class="grid3">
							<label class="field"
								><span>Id</span><input
									value={key}
									onchange={(e) => rename('enemies', key, e.currentTarget.value)}
								/></label
							>
							<label class="field"><span>Name</span><input bind:value={en.name} /></label>
							<label class="field">
								<span>Figure</span>
								<select bind:value={en.model}
									>{#each models.enemy as m (m)}<option value={m}>{m}</option>{/each}</select
								>
							</label>
							<label class="field">
								<span>Fights by</span>
								<select bind:value={en.behavior}>
									<option value="rush">Rushing in</option>
									<option value="skirmish">Skirmishing (ranged second attack)</option>
									<option value="guardian">Guarding a post</option>
									<option value="grasp">Grasping (rooted)</option>
								</select>
							</label>
							<label class="field"
								><span>Hit points</span><input
									type="number"
									min="1"
									bind:value={en.hp.base}
								/></label
							>
							<label class="field"
								><span>+ per character</span><input
									type="number"
									min="0"
									bind:value={en.hp.perCharacter}
								/></label
							>
							<label class="field"
								><span>Armor</span><input type="number" min="0" bind:value={en.armor} /></label
							>
							<label class="field"
								><span>Speed</span><input type="number" min="0" bind:value={en.speed} /></label
							>
							<label class="field"
								><span>Vision</span><input type="number" min="1" bind:value={en.vision} /></label
							>
							<label class="field"
								><span>Initiative bonus</span><input
									type="number"
									bind:value={en.initiative}
								/></label
							>
							<label class="field"
								><span>Light carried</span><input
									type="number"
									min="0"
									bind:value={en.light}
								/></label
							>
							<label class="field"
								><span>Colour</span><input type="color" bind:value={en.color} /></label
							>
						</div>
						<h4>Attacks (the first up close, a second from range)</h4>
						{#each en.attacks as a, i (i)}
							<div class="objective">
								<input aria-label="Attack" bind:value={a.name} />
								<label class="field"
									><span>Range</span><input type="number" min="1" bind:value={a.range} /></label
								>
								<label class="field"
									><span>To hit</span><input type="number" bind:value={a.toHit} /></label
								>
								<label class="field"><span>Damage</span><input bind:value={a.damage} /></label>
								<button
									type="button"
									aria-label="Remove attack"
									onclick={() => en.attacks.splice(i, 1)}>×</button
								>
							</div>
						{/each}
						{#if en.attacks.length < 2}
							<button
								type="button"
								onclick={() =>
									en.attacks.push({ name: 'Strike', range: 1, toHit: 3, damage: '1d6' })}
								>Add an attack</button
							>
						{/if}
						<button type="button" class="danger" onclick={() => remove('enemies', key)}
							>Remove enemy</button
						>
					</details>
				{/each}
				<button
					type="button"
					onclick={() =>
						add(draft.enemies, 'enemy', {
							name: 'A foe',
							model: models.enemy[0] ?? 'hound',
							color: '#8a3b3b',
							armor: 1,
							speed: 5,
							vision: 6,
							light: 0,
							initiative: 0,
							hp: { base: 6, perCharacter: 2 },
							attacks: [{ name: 'Strike', range: 1, toHit: 3, damage: '1d6' }],
							behavior: 'rush'
						})}
				>
					Add an enemy
				</button>
				<h2>Encounters</h2>
				{#each Object.entries(draft.encounters) as [key, enc] (key)}
					<details class="card">
						<summary
							><strong>{enc.name}</strong>
							<span class="muted"
								>{enc.foes.map((f) => draft.enemies[f.kind]?.name ?? f.kind).join(', ')}</span
							></summary
						>
						<div class="grid3">
							<label class="field"
								><span>Id</span><input
									value={key}
									onchange={(e) => rename('encounters', key, e.currentTarget.value)}
								/></label
							>
							<label class="field"><span>Name</span><input bind:value={enc.name} /></label>
							<label class="field">
								<span>Fought at</span>
								<select
									value={enc.location ?? ''}
									onchange={(e) => (enc.location = e.currentTarget.value || null)}
								>
									<option value="">Anywhere</option>
									{#each ids.locations as l (l)}<option value={l}>{draft.locations[l].name}</option
										>{/each}
								</select>
							</label>
							<label class="field">
								<span>Foes (enemy ids)</span>
								<ListInput
									label="Foes"
									options="ids-enemies"
									bind:value={
										() => enc.foes.map((f) => f.kind),
										(v) => (enc.foes = (v ?? []).map((kind) => ({ kind })))
									}
								/>
							</label>
							<label class="field"
								><span>They come up at</span><CellsInput
									label="Where foes appear"
									bind:value={enc.ring}
								/></label
							>
							<label class="field">
								<span>Shown to all (area)</span>
								<input
									placeholder="x,y to x,y"
									value={enc.reveal ? formatArea(enc.reveal) : ''}
									onchange={(e) =>
										e.currentTarget.value.trim()
											? setArea(e.currentTarget.value, (a) => (enc.reveal = a))
											: delete enc.reveal}
								/>
							</label>
						</div>
						<label class="field"
							><span>Said as it begins</span><input
								value={enc.opening ?? ''}
								onchange={(e) =>
									e.currentTarget.value.trim()
										? (enc.opening = e.currentTarget.value)
										: delete enc.opening}
							/></label
						>
						<h4>When it is won</h4>
						<div class="grid2">
							<label class="field"
								><span>Said</span><input
									value={enc.won?.text ?? ''}
									onchange={(e) =>
										(enc.won = { ...enc.won, text: e.currentTarget.value || undefined })}
								/></label
							>
							<label class="field"
								><span>Makes happen</span><input
									list="ids-events"
									value={enc.won?.event ?? ''}
									onchange={(e) =>
										(enc.won = { ...enc.won, event: e.currentTarget.value.trim() || undefined })}
								/></label
							>
						</div>
						<EffectsEditor
							bind:effects={() => enc.won?.does ?? [], (d) => (enc.won = { ...enc.won, does: d })}
							label="Also"
						/>
						<button type="button" class="danger" onclick={() => remove('encounters', key)}
							>Remove encounter</button
						>
					</details>
				{/each}
				<button
					type="button"
					onclick={() =>
						add(draft.encounters, 'fight', {
							name: 'A fight',
							location: ids.locations[0] ?? null,
							ring: [{ x: 5, y: 5 }],
							foes: ids.enemies[0] ? [{ kind: ids.enemies[0] }] : []
						})}
				>
					Add an encounter
				</button>
			</section>
		{:else if section === 'things'}
			<section>
				<h2>Things to use</h2>
				<p class="muted">
					A thing is a prop on a table (or a door) with states, and verbs characters do to it. What
					a verb does is its rules.
				</p>
				{#each draft.objects as o, i (i)}
					<details class="card">
						<summary
							><strong>{o.name}</strong>
							<span class="muted"
								>{o.kind} at {draft.locations[o.location]?.name ?? o.location}</span
							></summary
						>
						<div class="grid3">
							<label class="field"><span>Id</span><input bind:value={o.id} /></label>
							<label class="field"><span>Name</span><input bind:value={o.name} /></label>
							<label class="field">
								<span>Kind</span>
								<select bind:value={o.kind}>
									{#each ['container', 'chest', 'book', 'table', 'torch', 'landmark', 'mechanism', 'item', 'door', 'secret', 'corpse', 'ritual'] as k (k)}<option
											value={k}>{k}</option
										>{/each}
								</select>
							</label>
							<label class="field">
								<span>Where</span>
								<select bind:value={o.location}>
									{#each ids.locations as l (l)}<option value={l}>{draft.locations[l].name}</option
										>{/each}
								</select>
							</label>
							<label class="field">
								<span>Which {thingOf(o)} on the table</span>
								{#if thingOf(o) === 'prop'}
									<select
										value={(o.thing as { prop: string }).prop}
										onchange={(e) => (o.thing = { prop: e.currentTarget.value })}
									>
										{#each propsOf(o.location) as p (p)}<option value={p}>{p}</option>{/each}
									</select>
								{:else}
									<input
										value={Object.values(o.thing)[0]}
										onchange={(e) =>
											(o.thing = {
												[thingOf(o)]: e.currentTarget.value.trim()
											} as ObjectDef['thing'])}
									/>
								{/if}
							</label>
							<label class="field">
								<span>Starts</span>
								<select bind:value={o.initial}
									>{#each OBJECT_STATES as s (s)}<option value={s}>{s}</option>{/each}</select
								>
							</label>
							<label class="field">
								<span>States the GM may set</span>
								<ListInput
									label="States"
									bind:value={
										() => o.states,
										(v) =>
											(o.states = (v ?? []).filter((s) =>
												(OBJECT_STATES as readonly string[]).includes(s)
											) as ObjectState[])
									}
								/>
							</label>
						</div>
						<h4>Verbs</h4>
						{#each o.verbs as verb, vi (vi)}
							<div class="line">
								<div class="grid3">
									<label class="field"><span>Verb id</span><input bind:value={verb.id} /></label>
									<label class="field"><span>Label</span><input bind:value={verb.label} /></label>
									<label class="field">
										<span>Leaves it</span>
										<select
											value={verb.to ?? ''}
											onchange={(e) =>
												e.currentTarget.value
													? (verb.to = e.currentTarget.value as ObjectState)
													: delete verb.to}
										>
											<option value="">as it was</option>
											{#each OBJECT_STATES as s (s)}<option value={s}>{s}</option>{/each}
										</select>
									</label>
									<label class="field">
										<span>Can be done when it is</span>
										<ListInput
											label="From states"
											bind:value={
												() => verb.from,
												(v) =>
													(verb.from = (v ?? []).filter((s) =>
														(OBJECT_STATES as readonly string[]).includes(s)
													) as ObjectState[])
											}
										/>
									</label>
									<label class="field">
										<span>Check (stat)</span>
										<select
											value={verb.check?.stat ?? ''}
											onchange={(e) =>
												e.currentTarget.value
													? (verb.check = {
															stat: e.currentTarget.value as never,
															dc: verb.check?.dc ?? 12
														})
													: delete verb.check}
										>
											<option value="">none</option>
											{#each STATS as st (st.id)}<option value={st.id}>{st.name}</option>{/each}
										</select>
									</label>
									{#if verb.check}
										<label class="field"
											><span>Difficulty</span><input
												type="number"
												min="1"
												max="40"
												bind:value={verb.check.dc}
											/></label
										>
									{/if}
								</div>
								<RulesEditor bind:rules={() => [...(verb.does ?? [])], (r) => (verb.does = r)} />
								<button type="button" onclick={() => o.verbs.splice(vi, 1)}>Remove verb</button>
							</div>
						{/each}
						<button
							type="button"
							onclick={() =>
								o.verbs.push({
									id: idFrom(
										'use',
										o.verbs.map((v) => v.id)
									),
									label: 'Use',
									from: ['interactable']
								})}>Add a verb</button
						>
						<button type="button" class="danger" onclick={() => draft.objects.splice(i, 1)}
							>Remove thing</button
						>
					</details>
				{/each}
				<button
					type="button"
					onclick={() =>
						draft.objects.push({
							id: idFrom('thing', ids.objects),
							name: 'A thing',
							kind: 'container',
							location: ids.locations[0] ?? '',
							thing: { prop: propsOf(ids.locations[0] ?? '')[0] ?? '' },
							initial: 'interactable',
							states: ['interactable', 'used'],
							verbs: [
								{
									id: 'examine',
									label: 'Examine',
									from: ['interactable'],
									does: [{ do: [{ say: '…' }] }]
								}
							]
						})}
				>
					Add a thing
				</button>

				<h2>Trigger areas</h2>
				<p class="muted">Walking into an area during a chapter makes an event happen.</p>
				{#each draft.areas as a, i (i)}
					<div class="objective">
						<input
							aria-label="Area"
							placeholder="x,y to x,y"
							value={formatArea(a)}
							onchange={(e) => setArea(e.currentTarget.value, (r) => Object.assign(a, r))}
						/>
						<select aria-label="On the table" bind:value={a.location}
							>{#each ids.locations as l (l)}<option value={l}>{draft.locations[l].name}</option
								>{/each}</select
						>
						<select aria-label="During the chapter" bind:value={a.during}
							>{#each ids.chapters as c (c)}<option value={c}>{draft.chapters[c].title}</option
								>{/each}</select
						>
						<input aria-label="Makes happen" list="ids-events" bind:value={a.event} />
						<button type="button" aria-label="Remove area" onclick={() => draft.areas.splice(i, 1)}
							>×</button
						>
					</div>
				{/each}
				<button
					type="button"
					onclick={() =>
						draft.areas.push({
							from: { x: 0, y: 0 },
							to: { x: 1, y: 1 },
							location: ids.locations[0] ?? '',
							during: ids.chapters[0] ?? '',
							event: ids.events[0] ?? ''
						})}
				>
					Add an area
				</button>

				<h2>Clues</h2>
				{#each Object.entries(draft.clues) as [key, clue] (key)}
					<details class="card">
						<summary
							><strong>{clue.title}</strong>
							<span class="muted">{EVIDENCE_KINDS[clue.kind]}</span></summary
						>
						<div class="grid3">
							<label class="field"
								><span>Id</span><input
									value={key}
									onchange={(e) => rename('clues', key, e.currentTarget.value)}
								/></label
							>
							<label class="field"><span>Title</span><input bind:value={clue.title} /></label>
							<label class="field">
								<span>Kind</span>
								<select bind:value={clue.kind}
									>{#each Object.entries(EVIDENCE_KINDS) as [k, label] (k)}<option value={k}
											>{label}</option
										>{/each}</select
								>
							</label>
						</div>
						<textarea aria-label="What it says" rows="2" bind:value={clue.text}></textarea>
						<label class="field">
							<span>Once the party knows it, makes happen</span>
							<input
								list="ids-events"
								value={clue.unlocks ?? ''}
								onchange={(e) =>
									e.currentTarget.value.trim()
										? (clue.unlocks = e.currentTarget.value.trim())
										: delete clue.unlocks}
							/>
						</label>
						<button type="button" class="danger" onclick={() => remove('clues', key)}
							>Remove clue</button
						>
					</details>
				{/each}
				<button
					type="button"
					onclick={() => add(draft.clues, 'clue', { title: 'A clue', text: '…', kind: 'object' })}
					>Add a clue</button
				>
			</section>
		{:else if section === 'choices'}
			<section>
				<h2>Choices</h2>
				<p class="muted">
					A choice is put to the party by an Offer effect; each answer does something (make an event
					happen, go to a chapter, give a reward).
				</p>
				{#each Object.entries(draft.decisions) as [key, d] (key)}
					<div class="card">
						<div class="grid2">
							<label class="field"
								><span>Id</span><input
									value={key}
									onchange={(e) => rename('decisions', key, e.currentTarget.value)}
								/></label
							>
							<label class="field"><span>Question</span><input bind:value={d.prompt} /></label>
						</div>
						{#each d.options as o, i (i)}
							<div class="line">
								<div class="grid2">
									<label class="field"><span>Answer id</span><input bind:value={o.id} /></label>
									<label class="field"><span>Answer</span><input bind:value={o.label} /></label>
								</div>
								<EffectsEditor bind:effects={o.does} label="Choosing it" />
								<button type="button" onclick={() => d.options.splice(i, 1)}>Remove answer</button>
							</div>
						{/each}
						<button
							type="button"
							onclick={() =>
								d.options.push({
									id: idFrom(
										'answer',
										d.options.map((o) => o.id)
									),
									label: 'An answer',
									does: []
								})}>Add an answer</button
						>
						<button type="button" class="danger" onclick={() => remove('decisions', key)}
							>Remove choice</button
						>
					</div>
				{/each}
				<button
					type="button"
					onclick={() => add(draft.decisions, 'choice', { prompt: 'What now?', options: [] })}
					>Add a choice</button
				>

				<h2>Endings</h2>
				<div class="grid2">
					<label class="field">
						<span>The choice that decides the ending</span>
						<select bind:value={draft.endings.decision}
							>{#each ids.decisions as d (d)}<option value={d}>{d}</option>{/each}</select
						>
					</label>
					<label class="field">
						<span>If it was never answered</span>
						<select bind:value={draft.endings.fallback}>
							{#each draft.decisions[draft.endings.decision]?.options ?? [] as o (o.id)}<option
									value={o.id}>{o.label}</option
								>{/each}
						</select>
					</label>
				</div>
				{#each draft.decisions[draft.endings.decision]?.options ?? [] as o (o.id)}
					{@const e = draft.endings.byAnswer[o.id]}
					<div class="card">
						<h3>If they answer “{o.label}”</h3>
						{#if !e}
							<button
								type="button"
								onclick={() =>
									(draft.endings.byAnswer[o.id] = {
										ending: o.id,
										subtitle: '…',
										headline: '…',
										text: '…',
										scene: '…',
										cue: 'flash',
										result: []
									})}
							>
								Write this ending
							</button>
						{:else}
							<div class="grid3">
								<label class="field">
									<span>Ending id</span>
									<input
										value={e.ending}
										onchange={(ev) => {
											const id = ev.currentTarget.value.trim();
											e.ending = id;
											draft.endings.names[id] ??= { title: id };
										}}
									/>
								</label>
								<label class="field">
									<span>Ending’s name</span>
									<input
										value={draft.endings.names[e.ending]?.title ?? ''}
										onchange={(ev) =>
											(draft.endings.names[e.ending] = { title: ev.currentTarget.value })}
									/>
								</label>
								<label class="field"><span>Headline</span><input bind:value={e.headline} /></label>
								<label class="field"><span>Subtitle</span><input bind:value={e.subtitle} /></label>
								<label class="field">
									<span>Last moment</span>
									<select bind:value={e.cue}
										><option value="flash">A flash of light</option><option value="toll"
											>A bell tolls</option
										></select
									>
								</label>
							</div>
							<label class="field"
								><span>What happens</span><textarea rows="2" bind:value={e.text}></textarea></label
							>
							<label class="field"
								><span>The table, at the last</span><textarea rows="2" bind:value={e.scene}
								></textarea></label
							>
							<h4>What came of it</h4>
							{#each e.result as row, i (i)}
								<div class="objective">
									<input aria-label="What" bind:value={row.label} />
									<input aria-label="Became" bind:value={row.value} />
									<button
										type="button"
										aria-label="Remove row"
										onclick={() => e.result.splice(i, 1)}>×</button
									>
								</div>
							{/each}
							<button
								type="button"
								onclick={() => e.result.push({ label: 'The village', value: '…' })}
								>Add a row</button
							>
							<h4>And the table changes</h4>
							<EffectsEditor
								bind:effects={() => e.does ?? [], (d) => (e.does = d)}
								label="Final changes"
							/>
						{/if}
					</div>
				{/each}
			</section>
		{:else if section === 'check'}
			<section>
				<h2>Check</h2>
				{#if problems.length === 0}
					<p class="ok">Nothing wrong: it is ready to play.</p>
				{:else}
					<p>
						{problems.length}
						{problems.length === 1 ? 'thing needs' : 'things need'} fixing before it can be played:
					</p>
					<ul class="problems">
						{#each problems as p (p)}<li>{p}</li>{/each}
					</ul>
				{/if}
				<h3>Rewards the party can earn</h3>
				{#if rewards.length}
					<ul>
						{#each rewards as r (r)}<li>{r}</li>{/each}
					</ul>
				{:else}
					<p class="muted">None yet: add a “Give a reward” effect anywhere.</p>
				{/if}
				<h3>At a glance</h3>
				<p class="muted">
					{ids.locations.length} places, {ids.chapters.length} chapters, {ids.events.length} events,
					{ids.npcs.length} people, {draft.objects.length} things, {ids.clues.length} clues,
					{ids.encounters.length} fights, {ids.decisions.length} choices,
					{Object.keys(draft.endings.names).length} endings.
				</p>
			</section>
		{:else if section === 'json'}
			<section>
				<h2>The adventure file</h2>
				<p class="muted">
					Everything above, as the file it saves to. Edit it here for what the forms don’t cover
					(mechanisms, signs, phases of a fight, the rules’ own words), then apply.
				</p>
				<textarea class="json" aria-label="Adventure file" rows="28" bind:value={jsonText}
				></textarea>
				<div class="row">
					<button
						type="button"
						onclick={() => (jsonText = JSON.stringify($state.snapshot(draft), null, 2))}
						>Reload from the forms</button
					>
					<button class="primary" type="button" onclick={applyJson}>Apply</button>
				</div>
			</section>
		{/if}
	</main>
</div>

<style>
	.builder {
		max-width: 64rem;
		margin: 0 auto;
		padding: 1rem 1rem 4rem;
	}

	header {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		flex-wrap: wrap;
	}

	header h1 {
		font-size: 1.3rem;
		margin: 0 0 0 0.5rem;
	}

	.home {
		color: var(--muted);
		text-decoration: none;
		font-weight: 600;
	}

	.spacer {
		flex: 1;
	}

	.name {
		width: 9rem;
	}

	nav {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
		margin: 1rem 0;
		border-bottom: 1px solid var(--border);
		padding-bottom: 0.5rem;
	}

	nav button[aria-current='page'] {
		border-color: var(--accent);
		color: var(--accent);
	}

	.badge {
		display: inline-block;
		min-width: 1.1rem;
		margin-left: 0.3rem;
		padding: 0 0.3rem;
		border-radius: 999px;
		background: var(--danger);
		color: var(--bg);
		font-size: 0.75rem;
	}

	.badge.ok {
		background: var(--ok);
	}

	section {
		display: grid;
		gap: 0.6rem;
	}

	h2 {
		margin: 0.8rem 0 0;
		font-size: 1.1rem;
	}

	h3 {
		margin: 0.6rem 0 0;
		font-size: 0.95rem;
	}

	h4 {
		margin: 0.4rem 0 0;
		font-size: 0.85rem;
		color: var(--muted);
	}

	.card {
		display: grid;
		gap: 0.45rem;
		padding: 0.6rem 0.75rem;
		border: 1px solid var(--border);
		border-radius: 6px;
		background: var(--panel);
	}

	details.card > summary {
		cursor: pointer;
	}

	.field {
		display: grid;
		gap: 0.15rem;
		font-size: 0.8rem;
		color: var(--muted);
	}

	.field input,
	.field select,
	.field textarea {
		color: var(--text);
	}

	.grid2,
	.grid3 {
		display: grid;
		gap: 0.4rem 0.6rem;
		grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
	}

	.grid3 {
		grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr));
	}

	.row {
		display: flex;
		gap: 0.4rem;
		flex-wrap: wrap;
		align-items: center;
	}

	.objective {
		display: grid;
		grid-template-columns: 2fr 1fr 1fr auto auto;
		gap: 0.3rem;
		align-items: end;
	}

	.line {
		display: grid;
		gap: 0.3rem;
		padding: 0.4rem;
		border-left: 2px solid var(--border);
	}

	.check {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.85rem;
	}

	fieldset {
		border: 1px solid var(--border);
		border-radius: 6px;
		display: grid;
		gap: 0.25rem;
	}

	textarea {
		font: inherit;
		width: 100%;
		box-sizing: border-box;
	}

	.json {
		font-family: ui-monospace, monospace;
		font-size: 0.8rem;
	}

	.file-button {
		display: inline-block;
		padding: 0.35rem 0.7rem;
		border: 1px solid var(--border);
		border-radius: 6px;
		cursor: pointer;
	}

	.danger {
		color: var(--danger);
	}

	.muted {
		color: var(--muted);
		font-size: 0.85rem;
	}

	.table-info {
		margin: 0;
		font-size: 0.85rem;
	}

	.flow {
		margin: 0;
		padding-left: 1.2rem;
		display: grid;
		gap: 0.2rem;
	}

	.flow .branch {
		color: var(--accent);
	}

	.problems li {
		color: var(--danger);
	}

	.ok {
		color: var(--ok);
	}

	.error {
		color: var(--danger);
	}

	.notice {
		color: var(--ok);
	}

	@media (max-width: 40rem) {
		.objective {
			grid-template-columns: 1fr;
		}
	}
</style>
