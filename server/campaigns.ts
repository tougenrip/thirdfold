// Campaigns (milestone 58): a GM's party carried from adventure to
// adventure. The record is the server's alone, owned by the GM's lasting
// key (its hash, as saves are): what it plays by (the rules at their exact
// version and the content they read, pinned when it began), its roster (each
// character as its rules save it, with who plays it and where it stands),
// the adventures it has played, and the rewards earned along the way. A
// table opens a campaign; an adventure started there brings the campaign's
// active characters into the story (engine.ts `startAdventure`), and
// returning the story (`closeStory`) writes what came of it back: the
// history, each character's gear and fate, a full rest between adventures,
// a level by milestone where the rules can make it, and characters met on
// the way waiting for the GM's approval. Everything read back is checked in
// full, by the rules for the characters.

import { randomBytes } from 'node:crypto';
import {
	CAMPAIGN_ID_PATTERN,
	CAMPAIGN_LIMITS,
	ROSTER_STATUSES,
	normalizeCampaignName,
	type CampaignSummary,
	type CampaignView,
	type HistoryEntry,
	type RosterOp,
	type RosterStatus
} from '../src/lib/game/campaign';
import { normalizeName } from '../src/lib/game/names';
import type { ContentPin } from '../src/lib/adventure/versions';
import { savedPins } from './adventure/lock';
import { findRuleset, type JsonData, type RulesetRef } from './rules/ruleset';

export const CAMPAIGN_VERSION = 1;
/** The rules a campaign begun at a table plays by (the only ones that carry characters yet). */
export const CAMPAIGN_RULES: RulesetRef = { id: 'dnd-5.5e', version: 1 };
/** Roster ids are the ids the characters play under in a story: pc-1, pc-2, … */
export const ROSTER_ID = /^pc-[1-9][0-9]?$/;

export interface RosterEntry {
	id: string;
	/** The player's name (as they sit at a table), or null for anyone the GM seats. */
	player: string | null;
	status: RosterStatus;
	/** Adventures it has been through. */
	adventures: number;
	/** The character as its rules save it. */
	saved: JsonData;
}

export interface CampaignRecord {
	version: number;
	id: string;
	/** Whose campaign it is (a GM key's hash). */
	owner: string;
	name: string;
	rules: RulesetRef;
	content: ContentPin[];
	createdAt: string;
	updatedAt: string;
	roster: RosterEntry[];
	history: HistoryEntry[];
	rewards: string[];
	/** The adventure being played for it, at which table, since when. */
	playing: { room: string; title: string; since: string } | null;
}

export type CampaignResult = { ok: true; record: CampaignRecord } | { ok: false; message: string };

/** A new campaign under `rules`, which must carry characters between adventures. */
export function newCampaign(
	owner: string,
	rawName: unknown,
	rules: RulesetRef,
	now = new Date()
): CampaignResult {
	const name = normalizeCampaignName(rawName);
	if (!name)
		return {
			ok: false,
			message: `Give the campaign a name (at most ${CAMPAIGN_LIMITS.name} characters).`
		};
	const ruleset = findRuleset(rules);
	if (!ruleset) return { ok: false, message: 'This server does not have those rules.' };
	if (!ruleset.progression || !ruleset.builder)
		return {
			ok: false,
			message: `${ruleset.name} carry no characters from one adventure to the next.`
		};
	const at = now.toISOString();
	return {
		ok: true,
		record: {
			version: CAMPAIGN_VERSION,
			id: randomBytes(16).toString('hex'),
			owner,
			name,
			rules: { id: rules.id, version: rules.version },
			content: ruleset.contentPins?.() ?? [],
			createdAt: at,
			updatedAt: at,
			roster: [],
			history: [],
			rewards: [],
			playing: null
		}
	};
}

// ---------------------------------------------------------------------------
// Reading a stored record back

type Raw = Record<string, unknown>;
const isObject = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;
const isDate = (v: unknown): v is string =>
	typeof v === 'string' && v.length <= 40 && !Number.isNaN(Date.parse(v));
const count = (v: unknown, max: number): v is number =>
	typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max;
const keysAre = (o: Raw, keys: readonly string[]) => Object.keys(o).every((k) => keys.includes(k));

/**
 * A stored campaign read back: every field checked, every character read by
 * its rules. A damaged record is refused whole, never half trusted.
 */
export function readCampaign(raw: unknown): CampaignResult {
	const bad = (why: string): CampaignResult => ({ ok: false, message: `campaign: ${why}` });
	if (!isObject(raw)) return bad('not an object');
	const keys = [
		'version',
		'id',
		'owner',
		'name',
		'rules',
		'content',
		'createdAt',
		'updatedAt',
		'roster',
		'history',
		'rewards',
		'playing'
	];
	if (!keysAre(raw, keys)) return bad('a field this server does not know');
	if (raw.version !== CAMPAIGN_VERSION)
		return bad(`version ${String(raw.version)} is not one this server reads`);
	if (typeof raw.id !== 'string' || !CAMPAIGN_ID_PATTERN.test(raw.id)) return bad('id');
	if (typeof raw.owner !== 'string' || !/^[0-9a-f]{64}$/.test(raw.owner)) return bad('owner');
	const name = normalizeCampaignName(raw.name);
	if (!name || name !== raw.name) return bad('name');
	const r = raw.rules;
	if (!isObject(r) || typeof r.id !== 'string' || typeof r.version !== 'number')
		return bad('rules');
	const ruleset = findRuleset({ id: r.id, version: r.version });
	if (!ruleset?.progression)
		return bad(`rules ${r.id} v${String(r.version)} are not this server's`);
	const content = savedPins({ content: raw.content });
	if (!content) return bad('content');
	if (!isDate(raw.createdAt) || !isDate(raw.updatedAt)) return bad('dates');

	if (!Array.isArray(raw.roster) || raw.roster.length > CAMPAIGN_LIMITS.roster)
		return bad('roster');
	const roster: RosterEntry[] = [];
	for (const [i, e] of raw.roster.entries()) {
		if (!isObject(e) || !keysAre(e, ['id', 'player', 'status', 'adventures', 'saved']))
			return bad(`roster[${i}]`);
		if (typeof e.id !== 'string' || !ROSTER_ID.test(e.id) || roster.some((x) => x.id === e.id))
			return bad(`roster[${i}].id`);
		if (e.player !== null && (typeof e.player !== 'string' || normalizeName(e.player) !== e.player))
			return bad(`roster[${i}].player`);
		if (!ROSTER_STATUSES.includes(e.status as RosterStatus)) return bad(`roster[${i}].status`);
		if (!count(e.adventures, 10_000)) return bad(`roster[${i}].adventures`);
		const who = ruleset.progression.describe(e.saved as JsonData);
		if (!who || who.id !== e.id)
			return bad(`roster[${i}].saved: the rules don't read this character`);
		roster.push({
			id: e.id,
			player: e.player as string | null,
			status: e.status as RosterStatus,
			adventures: e.adventures,
			saved: e.saved as JsonData
		});
	}

	if (!Array.isArray(raw.history) || raw.history.length > CAMPAIGN_LIMITS.history)
		return bad('history');
	const history: HistoryEntry[] = [];
	for (const [i, h] of raw.history.entries()) {
		const entry = historyEntry(h);
		if (!entry) return bad(`history[${i}]`);
		history.push(entry);
	}
	const rewards = rewardList(raw.rewards, CAMPAIGN_LIMITS.rewards);
	if (!rewards) return bad('rewards');
	let playing: CampaignRecord['playing'] = null;
	if (raw.playing !== null) {
		const p = raw.playing;
		if (
			!isObject(p) ||
			!keysAre(p, ['room', 'title', 'since']) ||
			!text(p.room, 16) ||
			!text(p.title, 200) ||
			!isDate(p.since)
		)
			return bad('playing');
		playing = { room: p.room, title: p.title, since: p.since };
	}
	return {
		ok: true,
		record: {
			version: CAMPAIGN_VERSION,
			id: raw.id,
			owner: raw.owner,
			name,
			rules: { id: r.id, version: r.version },
			content,
			createdAt: raw.createdAt,
			updatedAt: raw.updatedAt,
			roster,
			history,
			rewards,
			playing
		}
	};
}

function rewardList(raw: unknown, max: number): string[] | null {
	if (!Array.isArray(raw) || raw.length > max) return null;
	return raw.every((x) => text(x, 200)) ? (raw as string[]) : null;
}

function historyEntry(h: unknown): HistoryEntry | null {
	if (
		!isObject(h) ||
		!keysAre(h, [
			'title',
			'adventure',
			'startedAt',
			'endedAt',
			'outcome',
			'ending',
			'rewards',
			'characters'
		])
	)
		return null;
	if (!text(h.title, 200) || !isDate(h.startedAt) || !isDate(h.endedAt)) return null;
	if (h.outcome !== 'complete' && h.outcome !== 'defeat' && h.outcome !== 'abandoned') return null;
	if (h.ending !== null && !text(h.ending, 200)) return null;
	const a = h.adventure;
	let adventure: HistoryEntry['adventure'];
	if (isObject(a) && Object.keys(a).length === 1 && text(a.builtIn, 64))
		adventure = { builtIn: a.builtIn };
	else if (isObject(a) && Object.keys(a).length === 1 && text(a.file, 100))
		adventure = { file: a.file };
	else if (
		isObject(a) &&
		Object.keys(a).length === 2 &&
		typeof a.library === 'string' &&
		/^[0-9a-f]{32}$/.test(a.library) &&
		count(a.version, 1000)
	)
		adventure = { library: a.library, version: a.version };
	else return null;
	const rewards = rewardList(h.rewards, 32);
	if (!rewards) return null;
	if (!Array.isArray(h.characters) || h.characters.length > 16) return null;
	const characters: HistoryEntry['characters'] = [];
	for (const c of h.characters) {
		if (
			!isObject(c) ||
			!keysAre(c, ['id', 'name', 'fate', 'level', 'advancedTo']) ||
			typeof c.id !== 'string' ||
			!ROSTER_ID.test(c.id) ||
			!text(c.name, 60) ||
			(c.fate !== 'alive' && c.fate !== 'dead') ||
			!count(c.level, 30) ||
			(c.advancedTo !== null && !count(c.advancedTo, 30))
		)
			return null;
		characters.push({
			id: c.id,
			name: c.name,
			fate: c.fate,
			level: c.level,
			advancedTo: c.advancedTo as number | null
		});
	}
	return {
		title: h.title,
		adventure,
		startedAt: h.startedAt,
		endedAt: h.endedAt,
		outcome: h.outcome,
		ending: h.ending as string | null,
		rewards,
		characters
	};
}

// ---------------------------------------------------------------------------
// Views

export function campaignView(record: CampaignRecord): CampaignView {
	const ruleset = findRuleset(record.rules);
	return {
		id: record.id,
		name: record.name,
		rules: { ...record.rules, name: ruleset?.name ?? record.rules.id },
		content: record.content.map((c) => ({ ...c })),
		createdAt: record.createdAt,
		updatedAt: record.updatedAt,
		roster: record.roster.map((e) => {
			const who = ruleset?.progression?.describe(e.saved);
			return {
				id: e.id,
				name: who?.name ?? e.id,
				title: who?.title ?? null,
				level: who?.level ?? 1,
				player: e.player,
				status: e.status,
				adventures: e.adventures
			};
		}),
		history: structuredClone(record.history),
		rewards: [...record.rewards],
		playing: record.playing ? { title: record.playing.title, since: record.playing.since } : null
	};
}

export function campaignSummary(record: CampaignRecord): CampaignSummary {
	return {
		id: record.id,
		name: record.name,
		rules: findRuleset(record.rules)?.name ?? record.rules.id,
		characters: record.roster.filter((e) => e.status === 'active' || e.status === 'pending').length,
		adventures: record.history.length,
		updatedAt: record.updatedAt
	};
}

// ---------------------------------------------------------------------------
// The GM's changes

const touched = (record: CampaignRecord, now: Date): CampaignRecord => ({
	...record,
	updatedAt: now.toISOString()
});

/** The roster's active characters, as many as a story takes. */
export const ACTIVE_MAX = 8;

/** A GM's change to the roster: approve a pending character, retire or restore one, or say who plays it. */
export function changeRoster(
	record: CampaignRecord,
	op: RosterOp,
	now = new Date()
): CampaignResult {
	const i = record.roster.findIndex((e) => e.id === op.character);
	if (i < 0) return { ok: false, message: 'The campaign has no such character.' };
	const entry = record.roster[i];
	const name = findRuleset(record.rules)?.progression?.describe(entry.saved)?.name ?? entry.id;
	const active = record.roster.filter((e) => e.status === 'active').length;
	let next: RosterEntry;
	switch (op.op) {
		case 'approve':
			if (entry.status !== 'pending')
				return { ok: false, message: `${name} is not waiting for approval.` };
			if (active >= ACTIVE_MAX)
				return {
					ok: false,
					message: `At most ${ACTIVE_MAX} characters go on an adventure. Retire one first.`
				};
			next = { ...entry, status: 'active' };
			break;
		case 'retire':
			if (entry.status === 'dead' || entry.status === 'retired')
				return { ok: false, message: `${name} is not on the active roster.` };
			next = { ...entry, status: 'retired' };
			break;
		case 'restore':
			if (entry.status !== 'retired') return { ok: false, message: `${name} is not retired.` };
			if (active >= ACTIVE_MAX)
				return {
					ok: false,
					message: `At most ${ACTIVE_MAX} characters go on an adventure. Retire one first.`
				};
			next = { ...entry, status: 'active' };
			break;
		case 'assign': {
			const player = op.player === null ? null : normalizeName(op.player);
			if (op.player !== null && !player)
				return { ok: false, message: 'That is not a player’s name.' };
			next = { ...entry, player };
			break;
		}
	}
	const roster = [...record.roster];
	roster[i] = next;
	return { ok: true, record: touched({ ...record, roster }, now) };
}

/** What a story's character came to, gathered by the engine when the story is returned. */
export interface StoryCharacter {
	/** Its id in the story. */
	id: string;
	/** Its saved form now (gear and all), or null when its rules don't carry it. */
	saved: JsonData | null;
	dead: boolean;
	/** Whose it is (the player's name), when someone played it. */
	player: string | null;
}

export interface StoryResult {
	title: string;
	adventure: HistoryEntry['adventure'];
	startedAt: string;
	outcome: HistoryEntry['outcome'];
	ending: string | null;
	rewards: string[];
	/** The roster ids the story was started with. */
	members: readonly string[];
	/** Every character that was in play. */
	characters: readonly StoryCharacter[];
}

export interface Returned {
	record: CampaignRecord;
	/** What happened, line by line, for the table. */
	lines: string[];
}

/**
 * A story returned to its campaign: its history entry written, each member
 * as the story left it (its gear kept) and rested in full, the fallen marked
 * dead, the survivors of a finished adventure advanced a level when
 * `advance` (where the rules can make it), and any other character played
 * that the rules carry put on the roster to wait for the GM's approval.
 */
export function closeStory(
	record: CampaignRecord,
	story: StoryResult,
	advance: boolean,
	now = new Date()
): { ok: true; returned: Returned } | { ok: false; message: string } {
	const progression = findRuleset(record.rules)?.progression;
	if (!progression)
		return { ok: false, message: 'This server no longer has the campaign’s rules.' };
	const roster = record.roster.map((e) => ({ ...e }));
	const lines: string[] = [];
	const characters: HistoryEntry['characters'] = [];
	const levelUp = advance && story.outcome === 'complete';
	// Characters built in the story keep their ids where the roster has room for them.
	const reserved = new Set(
		story.characters
			.filter((c) => ROSTER_ID.test(c.id) && !story.members.includes(c.id))
			.map((c) => c.id)
			.filter((id) => !record.roster.some((e) => e.id === id))
	);
	const freeId = () => {
		for (let n = 1; n <= 99; n++) {
			const id = `pc-${n}`;
			if (!roster.some((e) => e.id === id) && !reserved.has(id)) return id;
		}
		return null;
	};
	for (const c of story.characters) {
		const member = story.members.includes(c.id) ? roster.find((e) => e.id === c.id) : undefined;
		if (!member && (!c.saved || c.dead)) continue;
		let saved = c.saved ?? member!.saved;
		const before = progression.describe(saved);
		if (!before) {
			lines.push(`${c.id} could not be read back and was left as it was.`);
			continue;
		}
		let advancedTo: number | null = null;
		if (!c.dead) {
			saved = progression.recover(saved) ?? saved;
			if (levelUp) {
				const up = progression.advance(saved);
				if (up.ok) {
					saved = up.saved;
					advancedTo = up.level;
					lines.push(up.text);
				} else
					lines.push(`${before.name} stays at level ${before.level}: ${up.problems.join('; ')}.`);
			}
		} else lines.push(`${before.name} fell, and is remembered.`);
		if (member) {
			member.saved = saved;
			member.adventures += 1;
			if (c.dead) member.status = 'dead';
			characters.push({
				id: member.id,
				name: before.name,
				fate: c.dead ? 'dead' : 'alive',
				level: before.level,
				advancedTo
			});
			continue;
		}
		// A character met on the way: on the roster, waiting for the GM.
		if (roster.length >= CAMPAIGN_LIMITS.roster) {
			lines.push(`${before.name} doesn't fit on the roster (at most ${CAMPAIGN_LIMITS.roster}).`);
			continue;
		}
		const id = reserved.has(c.id) ? c.id : freeId();
		const moved = id && (id === before.id ? saved : progression.withId(saved, id));
		if (!id || !moved) continue;
		roster.push({ id, player: c.player, status: 'pending', adventures: 1, saved: moved });
		characters.push({ id, name: before.name, fate: 'alive', level: before.level, advancedTo });
		lines.push(`${before.name} joins the roster, waiting for the GM's approval.`);
	}
	const entry: HistoryEntry = {
		title: story.title,
		adventure: story.adventure,
		startedAt: story.startedAt,
		endedAt: now.toISOString(),
		outcome: story.outcome,
		ending: story.ending,
		rewards: story.rewards.slice(0, 32),
		characters
	};
	const history = [...record.history, entry].slice(-CAMPAIGN_LIMITS.history);
	const rewards = [...record.rewards, ...story.rewards].slice(-CAMPAIGN_LIMITS.rewards);
	return {
		ok: true,
		returned: {
			record: touched({ ...record, roster, history, rewards, playing: null }, now),
			lines
		}
	};
}

// ---------------------------------------------------------------------------
// Stores

export interface CampaignStore {
	/** Writes the record (a new one, or its next state). */
	save(record: CampaignRecord): Promise<void>;
	/** A record by id, read back and checked; null when there is none (or it is damaged). */
	get(id: string): Promise<CampaignRecord | null>;
	/** An owner's campaigns, latest first. */
	list(owner: string): Promise<CampaignRecord[]>;
	remove(id: string, owner: string): Promise<boolean>;
}
