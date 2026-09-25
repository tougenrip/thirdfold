// The adventure library: adventures creators publish from the builder, which
// any GM can find, play and rate, and games GMs list for anyone to join. The
// shapes here are what the wire carries; the library itself lives on the game
// server (server/library-store.ts). Plain TypeScript, relative imports only.

/** A published adventure's id: 128 random bits, hex. */
export const LIBRARY_ID_PATTERN = /^[0-9a-f]{32}$/;
/** A creator's public id (derived from their GM key's hash; never the key or the hash itself). */
export const CREATOR_ID_PATTERN = /^[0-9a-f]{16}$/;

export const LIBRARY_LIMITS = {
	/** A creator's name, as the library shows it. */
	creatorName: 40,
	/** A search. */
	query: 60,
	/** Adventures one listing returns. */
	list: 50,
	/** Adventures one creator may publish. */
	perCreator: 50,
	/** Versions one adventure keeps. */
	versions: 100,
	/** Public games one listing returns. */
	games: 50
} as const;

export const LIBRARY_SORTS = ['top', 'new', 'played'] as const;
/** Best rated, newest, or most played first. */
export type LibrarySort = (typeof LIBRARY_SORTS)[number];

export interface Creator {
	id: string;
	name: string;
}

/** The average of 1-5 stars, and how many gave them. */
export interface Rating {
	average: number;
	count: number;
}

/** A published adventure as the library shows it (its latest version). */
export interface LibraryListing {
	id: string;
	title: string;
	about: string;
	creator: Creator;
	version: number;
	publishedAt: string;
	plays: number;
	rating: Rating | null;
}

/** What an adventure file holds, counted: what a GM weighs when choosing one. */
export interface StoryFacts {
	chapters: number;
	places: number;
	/** The characters players choose from (one each, so this is the most who can play). */
	characters: number;
	endings: number;
}

/** One of the adventures that comes with thirdfold, as the library shows it. */
export interface BuiltInStory {
	id: string;
	title: string;
	about: string;
	/** How the story greets the party where it starts. */
	opening: string;
	facts: StoryFacts;
}

/** A published adventure opened in the library: its listing, its opening and its facts. */
export interface StoryDetail {
	listing: LibraryListing;
	opening: string;
	facts: StoryFacts;
}

/** One of a creator's own adventures, listed in the library or not. */
export interface MyAdventure extends LibraryListing {
	listed: boolean;
}

/** A game its GM listed for anyone to join. */
export interface PublicGame {
	roomId: string;
	/** The adventure being played, else the table's name. */
	title: string;
	gm: string;
	/** Players at the table (not spectators). */
	players: number;
	/** Where the story is: choosing characters, a chapter, or over; null for a free table. */
	status: string | null;
}

/** Trims, strips control characters; null when empty or too long. */
export function normalizeCreatorName(raw: unknown): string | null {
	if (typeof raw !== 'string') return null;
	// eslint-disable-next-line no-control-regex
	const name = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim();
	return name.length > 0 && name.length <= LIBRARY_LIMITS.creatorName ? name : null;
}

/** A search as the library matches it: lower case, spaces collapsed; null for none. */
export function normalizeQuery(raw: unknown): string | null {
	if (typeof raw !== 'string') return null;
	const q = raw.toLowerCase().replace(/\s+/g, ' ').trim();
	return q.length > 0 ? q.slice(0, LIBRARY_LIMITS.query) : null;
}

/** Whether a listing matches a (normalized) search: every word in its title, about or creator. */
export function matchesQuery(listing: LibraryListing, query: string | null): boolean {
	if (!query) return true;
	const hay = `${listing.title} ${listing.about} ${listing.creator.name}`.toLowerCase();
	return query.split(' ').every((word) => hay.includes(word));
}

/** Orders listings for a sort; ties go to the newest. */
export function sortListings(listings: LibraryListing[], sort: LibrarySort): LibraryListing[] {
	const newest = (a: LibraryListing, b: LibraryListing) =>
		b.publishedAt.localeCompare(a.publishedAt);
	const score = (l: LibraryListing) =>
		// Few ratings count for less: an average pulled toward 3 by two phantom middling votes.
		l.rating ? (l.rating.average * l.rating.count + 3 * 2) / (l.rating.count + 2) : 0;
	return [...listings].sort((a, b) => {
		if (sort === 'top') return score(b) - score(a) || b.plays - a.plays || newest(a, b);
		if (sort === 'played') return b.plays - a.plays || newest(a, b);
		return newest(a, b);
	});
}

/** A rating from its stars' sum and count. */
export function ratingOf(sum: number, count: number): Rating | null {
	return count > 0 ? { average: Math.round((sum / count) * 10) / 10, count } : null;
}
