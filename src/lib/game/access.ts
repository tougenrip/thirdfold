// Who may do what with what the library holds (milestone 54). An item (an
// adventure, a homebrew pack or a collection) has an access level, and its
// owner may grant others a role on it: a person (a creator, by their public
// id), a campaign (a collection, which may then carry it), or a table (a
// room, for a while). Grants are kept with who gave them and when, and are
// revoked rather than forgotten. The game server decides every request by
// these rules (server/library-access.ts); the page only shows them. Plain
// data, relative imports only.

import { CREATOR_ID_PATTERN, LIBRARY_ID_PATTERN } from './library';
import { ROOM_ID_PATTERN } from './names';

/**
 * `public`: listed, and anyone finds, reads, plays and includes it.
 * `restricted`: listed so anyone finds it, but only its owner and those
 * granted it may read, play or include it (licensed content).
 * `private`: not listed; only its owner and those granted it know it is there.
 */
export const LIBRARY_ACCESS = ['public', 'restricted', 'private'] as const;
export type LibraryAccess = (typeof LIBRARY_ACCESS)[number];

/** How the stored flags read as an access level. */
export function accessOf(listed: boolean, restricted: boolean): LibraryAccess {
	return !listed ? 'private' : restricted ? 'restricted' : 'public';
}

/** The stored flags for an access level. */
export function flagsOf(access: LibraryAccess): { listed: boolean; restricted: boolean } {
	return { listed: access !== 'private', restricted: access === 'restricted' };
}

/**
 * What can be done with an item:
 * - `list`: see it among the library's listings,
 * - `read`: open it (a story's opening, a collection's report),
 * - `use`: play it at a table,
 * - `include`: put it in a collection (which passes it on to whoever starts that),
 * - `export`: take its file away (a scene file carrying it),
 * - `publish`: add a version,
 * - `manage`: change its access, grant, revoke and remove it.
 */
export const LIBRARY_RIGHTS = [
	'list',
	'read',
	'use',
	'include',
	'export',
	'publish',
	'manage'
] as const;
export type LibraryRight = (typeof LIBRARY_RIGHTS)[number];

/**
 * A collaborator works on it with its owner (everything but managing it);
 * a member may find, read and play it.
 */
export const GRANT_ROLES = ['collaborator', 'member'] as const;
export type GrantRole = (typeof GRANT_ROLES)[number];

/** Whom a grant is for: a creator (by public id), a collection, or a table (a room's code). */
export type GrantTarget =
	| { kind: 'creator'; id: string }
	| { kind: 'collection'; id: string }
	| { kind: 'room'; id: string };
export const GRANT_TARGETS = ['creator', 'collection', 'room'] as const;

/** Who holds which rights: an owner all, a grant's role its own, anyone what the access level gives. */
export const RIGHTS: Record<'owner' | GrantRole | LibraryAccess, readonly LibraryRight[]> = {
	owner: LIBRARY_RIGHTS,
	collaborator: ['list', 'read', 'use', 'include', 'export', 'publish'],
	member: ['list', 'read', 'use'],
	public: ['list', 'read', 'use', 'include', 'export'],
	restricted: ['list'],
	private: []
};

/** A collection granted an item may carry it to whoever starts the collection. */
export const COLLECTION_RIGHTS: readonly LibraryRight[] = ['list', 'read', 'use', 'include'];

export const GRANT_LIMITS = {
	/** Grants in force on one item at a time. */
	active: 50,
	/** Grants kept on one item, revoked and lapsed ones too (the oldest of those go first). */
	kept: 200,
	note: 120,
	/** A table's grant lasts at most a day: room codes are short and come round again. */
	roomHours: 24,
	/** Any other grant may run out after at most a year, or never. */
	maxHours: 24 * 366
} as const;

/** A grant on an item, as given and as it stands. */
export interface Grant {
	/** 128 random bits, hex. */
	id: string;
	target: GrantTarget;
	role: GrantRole;
	/** The public creator id of whoever gave it (its owner). */
	by: string;
	/** When it was given. */
	at: string;
	/** When it runs out, if it does. */
	expires: string | null;
	/** When it was revoked, if it was. */
	revoked: string | null;
	/** What it is for, in the owner's words. */
	note: string;
}

/** A grant as its owner asks for it. */
export interface NewGrant {
	target: GrantTarget;
	role: GrantRole;
	/** Hours until it runs out; none for a grant that doesn't (a table's always does). */
	hours?: number;
	note?: string;
}

export const GRANT_ID_PATTERN = /^[0-9a-f]{32}$/;

/** In force: not revoked and not run out. */
export function grantActive(grant: Grant, now: number): boolean {
	return grant.revoked === null && (grant.expires === null || Date.parse(grant.expires) > now);
}

/** Whether a grant is for this target. */
export function sameTarget(a: GrantTarget, b: GrantTarget): boolean {
	return a.kind === b.kind && a.id === b.id;
}

type Raw = Record<string, unknown>;
const isObject = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A grant's target, checked: a creator's public id, a library id, a room's code. */
export function parseGrantTarget(raw: unknown): GrantTarget | null {
	if (!isObject(raw) || Object.keys(raw).length !== 2 || typeof raw.id !== 'string') return null;
	if (raw.kind === 'creator' && CREATOR_ID_PATTERN.test(raw.id))
		return { kind: 'creator', id: raw.id };
	if (raw.kind === 'collection' && LIBRARY_ID_PATTERN.test(raw.id))
		return { kind: 'collection', id: raw.id };
	if (raw.kind === 'room' && ROOM_ID_PATTERN.test(raw.id)) return { kind: 'room', id: raw.id };
	return null;
}

/**
 * A grant as asked for, checked: a collaborator is a person, a table's grant
 * runs out within a day, notes are short plain text. Null, or the reason.
 */
export function parseNewGrant(
	raw: unknown
): { ok: true; grant: NewGrant } | { ok: false; error: string } {
	if (!isObject(raw)) return { ok: false, error: 'A grant is an object.' };
	if (!Object.keys(raw).every((k) => ['target', 'role', 'hours', 'note'].includes(k)))
		return { ok: false, error: 'A grant has a target, a role, and maybe hours and a note.' };
	const target = parseGrantTarget(raw.target);
	if (!target)
		return { ok: false, error: 'Grant it to a creator id, a collection or a table code.' };
	if (!GRANT_ROLES.includes(raw.role as GrantRole))
		return { ok: false, error: 'A grant makes a collaborator or a member.' };
	const role = raw.role as GrantRole;
	if (role === 'collaborator' && target.kind !== 'creator')
		return { ok: false, error: 'Only a creator can be a collaborator.' };
	const max = target.kind === 'room' ? GRANT_LIMITS.roomHours : GRANT_LIMITS.maxHours;
	const hours = raw.hours ?? (target.kind === 'room' ? GRANT_LIMITS.roomHours : undefined);
	if (
		hours !== undefined &&
		(typeof hours !== 'number' || !Number.isInteger(hours) || hours < 1 || hours > max)
	)
		return { ok: false, error: `A grant like this runs for 1 to ${max} hours.` };
	if (raw.note !== undefined && typeof raw.note !== 'string')
		return { ok: false, error: 'A note is text.' };
	const note = ((raw.note as string | undefined) ?? '')
		// eslint-disable-next-line no-control-regex
		.replace(/[\u0000-\u001f\u007f]/g, ' ')
		.trim();
	if (note.length > GRANT_LIMITS.note)
		return { ok: false, error: `A note is at most ${GRANT_LIMITS.note} characters.` };
	return {
		ok: true,
		grant: {
			target,
			role,
			...(hours !== undefined ? { hours: hours as number } : {}),
			...(note ? { note } : {})
		}
	};
}

/** A whole grant read back from storage, or null when anything is off. */
export function parseGrant(raw: unknown): Grant | null {
	if (!isObject(raw)) return null;
	const target = parseGrantTarget(raw.target);
	const time = (v: unknown) => typeof v === 'string' && !Number.isNaN(Date.parse(v));
	if (
		!target ||
		typeof raw.id !== 'string' ||
		!GRANT_ID_PATTERN.test(raw.id) ||
		!GRANT_ROLES.includes(raw.role as GrantRole) ||
		typeof raw.by !== 'string' ||
		!CREATOR_ID_PATTERN.test(raw.by) ||
		!time(raw.at) ||
		!(raw.expires === null || time(raw.expires)) ||
		!(raw.revoked === null || time(raw.revoked)) ||
		typeof raw.note !== 'string' ||
		raw.note.length > GRANT_LIMITS.note
	)
		return null;
	return {
		id: raw.id,
		target,
		role: raw.role as GrantRole,
		by: raw.by,
		at: raw.at as string,
		expires: raw.expires as string | null,
		revoked: raw.revoked as string | null,
		note: raw.note
	};
}

/**
 * A grant a story's access rests on, kept with the story: a load or an
 * export checks it is still in force (milestone 54).
 */
export interface Entitlement {
	/** The library item. */
	item: string;
	/** The grant. */
	grant: string;
	role: GrantRole;
}

/** At most this many on a story: its adventure, its collection and what that carries. */
export const ENTITLEMENTS_MAX = 24;

/** A story's entitlements read back: well formed, each item once. */
export function parseEntitlements(raw: unknown): Entitlement[] | null {
	if (!Array.isArray(raw) || raw.length > ENTITLEMENTS_MAX) return null;
	const out: Entitlement[] = [];
	for (const e of raw) {
		if (
			!isObject(e) ||
			Object.keys(e).length !== 3 ||
			typeof e.item !== 'string' ||
			!LIBRARY_ID_PATTERN.test(e.item) ||
			typeof e.grant !== 'string' ||
			!GRANT_ID_PATTERN.test(e.grant) ||
			!GRANT_ROLES.includes(e.role as GrantRole) ||
			out.some((o) => o.item === e.item)
		)
			return null;
		out.push({ item: e.item, grant: e.grant, role: e.role as GrantRole });
	}
	return out;
}
