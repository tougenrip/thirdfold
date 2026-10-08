// What a story is pinned to (milestone 55): every piece of rules and content
// it plays by, at the exact version it found, kept with the story as its
// lock. A publisher's update never changes a story under way; the GM moves a
// story to another version only by asking, after the server has shown what
// changes and checked the story still reads under it, and can move it back.
// Plain data, relative imports only.

import type { Creator } from '../game/library';

/** A body of content the rules read (the SRD catalog): its source, pinned by hash, and the build of it. */
export interface ContentPin {
	/** The source's id, e.g. "srd-5.2.1". */
	id: string;
	name: string;
	version: string;
	/** SHA-256 of the source the content was made from. */
	sha256: string;
	/** A hash of the content as built (the catalog's files), so a rebuild of the same source shows. */
	build: string;
}

/** Where the adventure being played comes from. */
export type AdventurePin =
	/** One that comes with thirdfold: the release's own, by id and the version of its saved state. */
	| { kind: 'built-in'; id: string; version: number }
	/** A creator's adventure file, by its content's hash (from the library at a version, or a file). */
	| {
			kind: 'file';
			id: string;
			title: string;
			/** The library item and version it was published as, when it came from the library. */
			library: { id: string; version: number; creator: Creator } | null;
	  };

/** Everything a story plays by, each at the exact version it found. */
export interface StoryLock {
	rules: { id: string; version: number; name: string };
	content: ContentPin[];
	adventure: AdventurePin;
	/** Homebrew packs by their content ids (a changed pack is another pack). */
	packs: { id: string; name: string; version: string }[];
	collection: { id: string; version: number; title: string } | null;
}

/** One move of a story's content to another version, kept with the story. */
export interface VersionStep {
	/** The adventure's library version, or the collection's, moved. */
	what: 'adventure' | 'collection';
	/** Its library id. */
	item: string;
	from: number;
	to: number;
	/** Whether it moved back to a version it had before. */
	rollback: boolean;
	at: string;
}

/** At most this many steps are kept with a story (the oldest go first). */
export const VERSION_STEPS_MAX = 20;

/** What changed between two versions of a section of an adventure, by id. */
export interface SectionChange {
	section: string;
	added: string[];
	removed: string[];
	changed: string[];
}

/** The server's answer to "is there another version, and what would moving to it do?" */
export interface UpgradeReview {
	what: 'adventure' | 'collection';
	title: string;
	from: number;
	to: number;
	/** Whether `to` is older than `from`. */
	rollback: boolean;
	/** What changes, section by section (only sections that change). */
	changes: SectionChange[];
	/** Homebrew it adds and drops (collections). */
	packs: { added: string[]; removed: string[] };
	/** Why the story can't move (an empty list when it can). */
	problems: string[];
	ok: boolean;
}

/** The view's versions of a story: its lock and the steps it was moved by (the GM's). */
export interface VersionsView {
	lock: StoryLock;
	steps: VersionStep[];
	/** What could be upgraded: whether it came from the library (an adventure or a collection). */
	movable: { adventure: boolean; collection: boolean };
}
