// Checking an adventure's content before it is played: every id it refers
// to (an event, a chapter, an object, a clue, a fight, an enemy...) is one
// it defines, and every dice expression parses. The engine trusts content it
// runs, so a mistake in it shows up here rather than mid-story.

import { parseDice } from '../../src/lib/game/dice';
import { AMBUSH, type AdventureDef, type Effect, type Rule, type When } from './define';

/** What is wrong with an adventure's content; empty when nothing is. */
export function validateAdventure(A: AdventureDef): string[] {
	const problems: string[] = [];
	const has = (record: object, id: string) => Object.hasOwn(record, id);
	const need = (ok: unknown, what: string) => {
		if (!ok) problems.push(what);
	};
	const event = (id: string, where: string) =>
		need(has(A.events, id), `${where}: no event "${id}"`);
	const chapter = (id: string, where: string) =>
		need(has(A.chapters, id), `${where}: no chapter "${id}"`);
	const location = (id: string, where: string) =>
		need(has(A.locations, id), `${where}: no location "${id}"`);
	const clue = (id: string, where: string) => need(has(A.clues, id), `${where}: no clue "${id}"`);
	const objectIds = new Set(A.objects.map((o) => o.id));
	const object = (id: string, where: string) =>
		need(objectIds.has(id), `${where}: no object "${id}"`);
	const encounter = (id: string, where: string) =>
		need(id === AMBUSH || has(A.encounters, id), `${where}: no fight "${id}"`);
	const enemy = (kind: string, where: string) =>
		need(has(A.enemies, kind), `${where}: no enemy "${kind}"`);
	const dice = (expression: string, where: string) =>
		need(parseDice(expression).ok, `${where}: bad dice "${expression}"`);
	const phases = new Set(
		Object.values(A.encounters).flatMap((e) => Object.keys(e.phases?.all ?? {}))
	);

	const when = (w: When | undefined, where: string) => {
		if (!w) return;
		for (const id of [...(w.clues ?? []), ...(w.found ?? []), ...(w.unfound ?? [])])
			clue(id, where);
		for (const id of [...(w.events ?? []), ...(w.not ?? [])]) event(id, where);
		if (w.pending) need(has(A.decisions, w.pending), `${where}: no choice "${w.pending}"`);
		for (const id of Object.keys(w.objects ?? {})) object(id, where);
		for (const id of w.chapter ?? []) chapter(id, where);
		for (const [id, option] of Object.entries(w.chose ?? {})) {
			need(
				A.decisions[id]?.options.some((o) => o.id === option),
				`${where}: no choice "${id}: ${option}"`
			);
		}
		if (w.phase) need(phases.has(w.phase), `${where}: no phase "${w.phase}"`);
		for (const id of Object.keys(w.fights ?? {})) encounter(id, where);
	};
	const rules = (list: readonly Rule[] | undefined, where: string) => {
		for (const r of list ?? []) {
			when(r.if, where);
			effects(r.do, where);
		}
	};
	const effects = (list: readonly Effect[] | undefined, where: string) => {
		for (const e of list ?? []) {
			if ('clue' in e) clue(e.clue, where);
			else if ('tell' in e) clue(e.tell, where);
			else if ('event' in e) event(e.event, where);
			else if ('set' in e) object(e.set, where);
			else if ('npc' in e) {
				need(
					A.npcs[e.npc]?.states.includes(e.becomes),
					`${where}: no state "${e.npc}: ${e.becomes}"`
				);
			} else if ('offer' in e) need(has(A.decisions, e.offer), `${where}: no choice "${e.offer}"`);
			else if ('fight' in e) encounter(e.fight, where);
			else if ('enter' in e) chapter(e.enter, where);
			else if ('post' in e) encounter(e.post, where);
			else if ('phase' in e) need(phases.has(e.phase), `${where}: no phase "${e.phase}"`);
			else if ('hurt' in e) {
				object(e.hurt.near, where);
				dice(e.hurt.dice, where);
			} else if ('spawn' in e) enemy(e.spawn.kind, where);
			else if ('rules' in e) rules(e.rules, where);
		}
	};

	// Where it starts.
	location(A.start.location, 'start');
	chapter(A.start.chapter, 'start');
	need(
		A.chapters[A.start.chapter]?.location === A.start.location,
		'start: the first chapter is played elsewhere'
	);
	effects(A.start.arrival, 'arrival');
	for (const [id, c] of Object.entries(A.characters)) need(c.id === id, `character ${id}: id`);

	// The story.
	for (const [id, c] of Object.entries(A.chapters)) {
		const where = `chapter ${id}`;
		need(c.id === id, `${where}: id`);
		location(c.location, where);
		event(c.next.on, where);
		if (c.next.to !== null) chapter(c.next.to, where);
		for (const o of c.objectives) {
			event(o.done, `${where}, objective ${o.id}`);
			if (o.after) event(o.after, `${where}, objective ${o.id}`);
		}
		effects(c.opening, `${where}, opening`);
	}
	for (const [id, e] of Object.entries(A.events)) effects(e.does, `event ${id}`);
	for (const a of A.areas) {
		const where = `area for ${a.event}`;
		event(a.event, where);
		chapter(a.during, where);
		location(a.location, where);
		if (a.after) event(a.after, where);
	}
	for (const [id, d] of Object.entries(A.decisions)) {
		need(d.id === id, `choice ${id}: id`);
		for (const o of d.options) {
			effects(o.does, `choice ${id}: ${o.id}`);
			for (const l of o.labels ?? []) when(l.if, `choice ${id}: ${o.id}`);
		}
	}
	const E = A.endings;
	const answers = A.decisions[E.decision]?.options.map((o) => o.id) ?? [];
	need(answers.length > 0, `endings: no choice "${E.decision}"`);
	need(has(E.byAnswer, E.fallback), `endings: no ending for "${E.fallback}"`);
	for (const answer of answers) need(has(E.byAnswer, answer), `endings: no ending for "${answer}"`);
	for (const [answer, ending] of Object.entries(E.byAnswer)) {
		need(has(E.names, ending.ending), `ending ${answer}: no name for "${ending.ending}"`);
		rules(ending.lines, `ending ${answer}`);
		effects(ending.does, `ending ${answer}`);
	}

	// People and things.
	for (const [id, npc] of Object.entries(A.npcs)) {
		const where = `person ${id}`;
		need(npc.id === id, `${where}: id`);
		location(npc.location, where);
		need(npc.states.length > 0, `${where}: no states`);
		need(npc.lines.length > 0, `${where}: no lines`);
		for (const l of npc.lines) {
			when(l.if, `${where}, line ${l.id}`);
			if (l.clue) clue(l.clue, `${where}, line ${l.id}`);
			if (l.event) event(l.event, `${where}, line ${l.id}`);
			if (l.becomes) need(npc.states.includes(l.becomes), `${where}, line ${l.id}: no state`);
		}
		need(!npc.lines.at(-1)?.if, `${where}: the last line should always apply`);
	}
	for (const p of A.peoplePlaces) when(p.if, `people's place ${p.place}`);
	for (const r of A.reactions) {
		const where = `reaction ${r.id}`;
		need(has(A.npcs, r.npc), `${where}: no person "${r.npc}"`);
		const [what, verb] = r.on.split(':');
		if (what === 'event') event(verb, where);
		else {
			need(
				A.objects.some((o) => o.id === what && o.verbs.some((v) => v.id === verb)),
				`${where}: nothing to "${r.on}"`
			);
		}
	}
	need(objectIds.size === A.objects.length, 'objects: an id is used twice');
	for (const o of A.objects) {
		const where = `object ${o.id}`;
		location(o.location, where);
		need(
			o.states.includes(o.initial) || o.initial === 'hidden',
			`${where}: starts in a state it can't be in`
		);
		if (o.litBy) object(o.litBy, where);
		if (o.firstFind) clue(o.firstFind, where);
		for (const v of o.verbs) {
			const at = `${where}: ${v.id}`;
			if (v.needs) object(v.needs, at);
			if (v.triggers) need(has(A.mechanisms, v.triggers), `${at}: no mechanism "${v.triggers}"`);
			rules(v.does, at);
		}
	}
	for (const s of A.signs) {
		location(s.location, `sign ${s.id}`);
		clue(s.clue, `sign ${s.id}`);
	}
	for (const [id, c] of Object.entries(A.clues)) {
		need(c.id === id, `clue ${id}: id`);
		if (c.unlocks) event(c.unlocks, `clue ${id}`);
	}
	for (const [id, m] of Object.entries(A.mechanisms)) {
		const where = `mechanism ${id}`;
		need(m.id === id, `${where}: id`);
		location(m.location, where);
		need(m.steps.length > 0, `${where}: no steps`);
		for (const step of m.steps) {
			if (step.set) object(step.set.object, where);
			if (step.event) event(step.event, where);
		}
	}

	// Fights.
	for (const [kind, e] of Object.entries(A.enemies)) {
		const where = `enemy ${kind}`;
		need(e.kind === kind, `${where}: kind`);
		need(e.attacks.length > 0, `${where}: no attacks`);
		for (const a of e.attacks) dice(a.damage, where);
		if (e.toll) dice(e.toll.damage, where);
	}
	for (const [id, e] of Object.entries(A.encounters)) {
		const where = `fight ${id}`;
		need(id !== AMBUSH, `${where}: "${AMBUSH}" is the GM's own`);
		if (e.location !== null) location(e.location, where);
		for (const f of [...e.foes, ...(e.more ?? []).flatMap((m) => m.foes)]) enemy(f.kind, where);
		for (const m of e.more ?? []) when(m.if, where);
		for (const s of e.sentries ?? []) enemy(s.kind, where);
		need(e.foes.length > 0 || (e.sentries?.length ?? 0) > 0, `${where}: nobody to fight`);
		if (e.phases) {
			need(has(e.phases.all, e.phases.first), `${where}: no phase "${e.phases.first}"`);
			for (const [name, p] of Object.entries(e.phases.all)) {
				const at = `${where}, phase ${name}`;
				if (p.cleared && p.cleared !== 'continue') event(p.cleared.event, at);
				if (p.until) event(p.until.event, at);
				if (p.hazard) {
					dice(p.hazard.damage, at);
					if (p.hazard.avoid) object(p.hazard.avoid, at);
				}
				if (p.counter) effects(p.counter.reached, at);
				effects(p.unanswered, at);
				effects(p.answered, at);
			}
		}
		if (e.won?.event) event(e.won.event, where);
		effects(e.won?.does, where);
		effects(e.calledOff, where);
		if (e.remains) object(e.remains.object, where);
	}
	if (A.ward) object(A.ward.object, 'ward');
	return problems;
}
