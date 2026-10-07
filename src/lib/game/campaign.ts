// Campaigns (milestone 58): a GM's party carried from adventure to
// adventure. A campaign is the server's record (server/campaigns.ts),
// owned by its GM's lasting key; this is what the wire carries of it: the
// GM's view (roster, history, what it plays by) and the one-line summary
// the GM picks from. Plain data, relative imports only.

import type { ContentPin } from '../adventure/versions';

/** Limits on a campaign. */
export const CAMPAIGN_LIMITS = {
	name: 60,
	/** Characters on the roster, retired and fallen included. */
	roster: 24,
	/** Adventures remembered in the history. */
	history: 64,
	/** Campaigns one GM keeps. */
	perOwner: 20,
	/** Rewards remembered, across adventures. */
	rewards: 128
} as const;

/** Campaign ids: 32 lower-case hex digits. */
export const CAMPAIGN_ID_PATTERN = /^[0-9a-f]{32}$/;

/**
 * Where a character stands on the roster: `active` (it comes along to the
 * next adventure), `pending` (built during an adventure, waiting for the GM
 * to approve it), `retired` (kept, but left home) or `dead`.
 */
export const ROSTER_STATUSES = ['active', 'pending', 'retired', 'dead'] as const;
export type RosterStatus = (typeof ROSTER_STATUSES)[number];

export interface RosterEntryView {
	id: string;
	name: string;
	/** e.g. "Orc Fighter 2 (Soldier)", as the rules title it. */
	title: string | null;
	level: number;
	/** The player who plays it (their name), or null for anyone the GM seats. */
	player: string | null;
	status: RosterStatus;
	/** Adventures it has been through. */
	adventures: number;
}

/** One adventure the campaign played, as it ended. */
export interface HistoryEntry {
	title: string;
	/** Where the adventure came from: a built-in id, or a library item at a version. */
	adventure: { builtIn: string } | { library: string; version: number } | { file: string };
	startedAt: string;
	endedAt: string;
	outcome: 'complete' | 'defeat' | 'abandoned';
	/** The ending's title, when it ended in one. */
	ending: string | null;
	rewards: string[];
	characters: {
		id: string;
		name: string;
		fate: 'alive' | 'dead';
		/** Its level before, and after any advancement. */
		level: number;
		advancedTo: number | null;
	}[];
}

/** The GM's view of a campaign. */
export interface CampaignView {
	id: string;
	name: string;
	rules: { id: string; version: number; name: string };
	/** The content its rules read, pinned when it began. */
	content: ContentPin[];
	createdAt: string;
	updatedAt: string;
	roster: RosterEntryView[];
	history: HistoryEntry[];
	/** Rewards the party has earned across its adventures. */
	rewards: string[];
	/** The adventure being played for it now, at a table, if any. */
	playing: { title: string; since: string } | null;
}

/** A campaign as the GM's list shows it. */
export interface CampaignSummary {
	id: string;
	name: string;
	rules: string;
	characters: number;
	adventures: number;
	updatedAt: string;
}

/** What everyone at a table sees of the campaign a story is played for. */
export interface CampaignStoryView {
	id: string;
	name: string;
	/** The roster characters brought into this story, with who plays each. */
	members: { id: string; player: string | null }[];
	/** The story has been returned to the campaign (its history written). */
	closed: boolean;
}

/** A GM's change to a campaign's roster. */
export type RosterOp =
	| { op: 'approve'; character: string }
	| { op: 'retire'; character: string }
	| { op: 'restore'; character: string }
	| { op: 'assign'; character: string; player: string | null };

export const ROSTER_OPS = ['approve', 'retire', 'restore', 'assign'] as const;

/** A campaign's name, trimmed, or null when it isn't one. */
export function normalizeCampaignName(raw: unknown): string | null {
	if (typeof raw !== 'string') return null;
	const name = raw.replace(/\s+/g, ' ').trim();
	return name.length >= 1 && name.length <= CAMPAIGN_LIMITS.name && !/[<>{}]/.test(name)
		? name
		: null;
}
