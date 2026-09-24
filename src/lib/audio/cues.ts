// What the table sounds like, worked out from what the client already has:
// the synced room state before and after a change, and the log entries that
// arrived with it. Pure (no Web Audio), so it is tested in Node; engine.ts
// turns these events into sound. Audio is presentation only: nothing here
// sends anything to the server.

import type { AdventureView } from '../adventure/adventure';
import type { ChatMessage } from '../game/chat';
import { gridDistance, type GridPos } from '../game/grid';
import type { Ambient } from '../game/lights';
import type { SceneObject } from '../game/objects';
import type { Token } from '../game/token';

/** What a floor sounds like underfoot. */
export type Surface = 'earth' | 'stone' | 'flesh';

export type AudioEvent =
	/** Someone walked `steps` cells, over `ms`; `mine` is the listener's own character. */
	| { kind: 'footsteps'; steps: number; ms: number; mine: boolean; surface: Surface }
	| { kind: 'door'; open: boolean }
	/** The bell: the great bell tolling, a flash of its light, a small hand bell. */
	| { kind: 'bell'; size: 'great' | 'flash' | 'hand' }
	| { kind: 'dice'; count: number }
	| { kind: 'hit'; heavy: boolean }
	| { kind: 'miss' }
	| { kind: 'heal' }
	| { kind: 'guard' }
	| { kind: 'burn' }
	| { kind: 'fall'; enemy: boolean }
	/** A check: found something, or nothing. */
	| { kind: 'check'; success: boolean }
	/** UI: the listener's turn in a fight; evidence found; a choice put; a new chapter; a rejected action. */
	| { kind: 'ui'; sound: 'turn' | 'clue' | 'decision' | 'chapter' | 'error' | 'click' };

/** The parts of the room the audio listens to. */
export interface AudioState {
	/** The listener's player id. */
	me: string;
	tokens: readonly Token[];
	objects: readonly SceneObject[];
	ambient: Ambient;
	adventure: AdventureView | null;
}

/** How long a token takes to glide `cells` (as tabletop/tokens.ts tweens it). */
export const walkMs = (cells: number) => Math.min(180 + cells * 70, 700);

/** Steps heard for one walk: one per cell, but never a drum roll. */
export const MAX_STEPS = 6;

export function surfaceOf(adventure: AdventureView | null): Surface {
	switch (adventure?.location.id) {
		case 'monastery':
		case 'hollow':
			return 'stone';
		case 'heart':
			return 'flesh';
		default:
			return 'earth';
	}
}

const myCharacterToken = (s: AudioState) =>
	s.adventure?.characters.find((c) => c.playerId === s.me)?.tokenId ?? null;

/**
 * The sounds of a change from `before` to `after`, with the log entries
 * that came in with it (oldest first). `before` null: the table was just
 * loaded, which makes no sound of its own.
 */
export function soundsFor(
	before: AudioState | null,
	after: AudioState,
	log: readonly ChatMessage[]
): AudioEvent[] {
	const events: AudioEvent[] = [];
	if (before) {
		const surface = surfaceOf(after.adventure);
		const mine = myCharacterToken(after);
		const was = new Map(before.tokens.map((t) => [t.id, t.pos]));
		// A new table (the party travelled) doesn't walk everyone there.
		const sameTable = before.adventure?.location.id === after.adventure?.location.id;
		for (const t of after.tokens) {
			const from = was.get(t.id);
			if (!from || !sameTable || samePos(from, t.pos)) continue;
			const cells = gridDistance(from, t.pos);
			events.push({
				kind: 'footsteps',
				steps: Math.min(cells, MAX_STEPS),
				ms: walkMs(cells),
				mine: t.id === mine,
				surface
			});
		}
		const doors = new Map(
			before.objects.flatMap((o) => (o.kind === 'door' ? [[o.id, o.open] as const] : []))
		);
		for (const o of after.objects) {
			if (o.kind !== 'door' || !doors.has(o.id) || doors.get(o.id) === o.open) continue;
			events.push({ kind: 'door', open: o.open });
		}
		events.push(...storySounds(before, after));
	}
	for (const m of log) events.push(...entrySounds(m, after.me));
	return events;
}

function samePos(a: GridPos, b: GridPos): boolean {
	return a.x === b.x && a.y === b.y;
}

/** Changes in the story: whose turn, who fell, what was found, what is asked, a new chapter. */
function storySounds(before: AudioState, after: AudioState): AudioEvent[] {
	const a = before.adventure;
	const b = after.adventure;
	if (!a || !b) return [];
	const events: AudioEvent[] = [];
	if (a.chapter.id !== b.chapter.id) events.push({ kind: 'ui', sound: 'chapter' });
	if (b.clues.length > a.clues.length) events.push({ kind: 'ui', sound: 'clue' });
	if (b.decision && b.decision.id !== a.decision?.id)
		events.push({ kind: 'ui', sound: 'decision' });
	const mine = b.characters.find((c) => c.playerId === after.me)?.id ?? null;
	const upBefore = a.encounter?.order[a.encounter.current];
	const upNow = b.encounter?.order[b.encounter.current];
	const turnChanged =
		!!b.encounter && (a.encounter?.current !== b.encounter.current || !a.encounter);
	if (turnChanged && mine && upNow?.characterId === mine && upBefore !== upNow) {
		events.push({ kind: 'ui', sound: 'turn' });
	}
	for (const c of b.characters) {
		const was = a.characters.find((x) => x.id === c.id);
		if (was && !was.downed && !was.dead && (c.downed || c.dead)) {
			events.push({ kind: 'fall', enemy: false });
		}
	}
	const foes = new Set(b.encounter?.enemies.map((e) => e.tokenId) ?? []);
	const gone = (a.encounter?.enemies ?? []).filter((e) => !foes.has(e.tokenId)).length;
	for (let i = 0; i < gone; i++) events.push({ kind: 'fall', enemy: true });
	return events;
}

/** What a log entry sounds like. */
function entrySounds(m: ChatMessage, me: string): AudioEvent[] {
	switch (m.kind) {
		case 'roll':
			return [{ kind: 'dice', count: diceIn(m.roll) }];
		case 'check':
			return [
				{ kind: 'dice', count: 1 },
				...(m.authorId === me ? [{ kind: 'check' as const, success: m.success }] : [])
			];
		case 'attack':
			return [
				{ kind: 'dice', count: m.damage ? 2 : 1 },
				m.hit ? { kind: 'hit', heavy: (m.damage?.total ?? 0) >= HEAVY_HIT } : { kind: 'miss' }
			];
		case 'ability':
			// The Bell Keeper tolling its bell: the Hollow's own voice.
			if (/toll/i.test(m.ability)) return [{ kind: 'bell', size: 'great' }];
			if (m.amount !== null && m.amount > 0) return [{ kind: 'heal' }];
			if (/guard/i.test(m.ability) || /guard/i.test(m.text)) return [{ kind: 'guard' }];
			if (/burn|fire|flame/i.test(m.ability + m.text)) return [{ kind: 'burn' }];
			return [];
		case 'narration':
			if (m.cue === 'toll') return [{ kind: 'bell', size: 'great' }];
			if (m.cue === 'flash') return [{ kind: 'bell', size: 'flash' }];
			return [];
		default:
			return [];
	}
}

/** Damage from one blow that sounds heavy. */
export const HEAVY_HIT = 8;

function diceIn(roll: { terms: readonly { kind: string; rolls?: readonly number[] }[] }): number {
	const n = roll.terms.reduce(
		(sum, t) => sum + (t.kind === 'dice' ? (t.rolls?.length ?? 0) : 0),
		0
	);
	return Math.max(1, Math.min(n, 6));
}

// ---------------------------------------------------------------------------
// Music

/** What the music is doing: its mood, and how hard it is pushing. */
export interface MusicState {
	mood: 'none' | 'village' | 'monastery' | 'hollow' | 'heart' | 'ending' | 'defeat';
	/** 0 calm, 1 tension (a choice, the dark), 2 a fight, 3 the finale's fight. */
	intensity: 0 | 1 | 2 | 3;
	/** The ending, when the story is over: its music resolves differently. */
	ending: string | null;
}

export const SILENCE: MusicState = { mood: 'none', intensity: 0, ending: null };

/** The music for where the story is, from the view the listener already has. */
export function musicFor(adventure: AdventureView | null, ambient: Ambient): MusicState {
	if (!adventure || adventure.stage === 'choosing') return SILENCE;
	if (adventure.stage === 'defeat') return { mood: 'defeat', intensity: 0, ending: null };
	if (adventure.stage === 'complete') {
		return { mood: 'ending', intensity: 0, ending: adventure.ending?.id ?? null };
	}
	// The built-in story's places have music of their own; any other place gets the village's.
	const mood = PLACE_MOODS[adventure.location.id] ?? 'village';
	const encounter = adventure.encounter;
	if (encounter)
		return {
			mood,
			intensity: encounter.counter || FINALE.has(adventure.chapter.id) ? 3 : 2,
			ending: null
		};
	const tense = !!adventure.decision || ambient === 'dark' || FINALE.has(adventure.chapter.id);
	return { mood, intensity: tense ? 1 : 0, ending: null };
}

const PLACE_MOODS: Readonly<Record<string, MusicState['mood']>> = {
	bellweather: 'village',
	monastery: 'monastery',
	hollow: 'hollow',
	heart: 'heart'
};

const FINALE = new Set(['the_waking', 'the_ringing', 'final_decision', 'the_descent']);

/** Whether moving from one music state to another is a change worth a transition. */
export function musicChanged(a: MusicState, b: MusicState): boolean {
	return a.mood !== b.mood || a.intensity !== b.intensity || a.ending !== b.ending;
}

// ---------------------------------------------------------------------------
// Ambience

/** The bed of sound under everything: the place, and the hour. */
export interface Ambience {
	place: 'open' | 'village' | 'monastery' | 'hollow' | 'heart';
	time: Ambient;
}

export function ambienceFor(adventure: AdventureView | null, ambient: Ambient): Ambience {
	const at = adventure?.location.id;
	const place =
		at === 'bellweather'
			? 'village'
			: at === 'monastery' || at === 'hollow' || at === 'heart'
				? at
				: 'open';
	return { place, time: ambient };
}
