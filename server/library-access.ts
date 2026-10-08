// The library's permissions (milestone 54, src/lib/game/access.ts): every
// request for something the library holds is decided here, by who asks
// (their GM key's hash, the table they are at, the collection they start
// from) against the item's owner, access level and grants. A decision that
// rests on a grant names it, so a story can keep where its access came from
// and check it again later (a revoked grant stops new loads and exports).

import {
	COLLECTION_RIGHTS,
	grantActive,
	RIGHTS,
	accessOf,
	type Entitlement,
	type Grant,
	type GrantRole,
	type LibraryAccess,
	type LibraryRight
} from '../src/lib/game/access';
import { creatorIdOf } from './library-store';

export type { Entitlement };

/** Who asks. */
export interface Subject {
	/** Their GM key's hash, when they sent a key (or the room's GM's). */
	owner?: string | null;
	/** The room they ask from, when at a table as its GM. */
	room?: string | null;
	/** The collection the request is on behalf of (starting it, or checking what it carries). */
	collection?: string | null;
}

/** What the library knows of an item that decides access. */
export interface Guarded {
	owner: string;
	listed: boolean;
	restricted: boolean;
	grants: readonly Grant[];
}

/** Why a request is allowed: as owner, by a grant, or because anyone may. */
export type Decision =
	| { ok: true; as: 'owner' }
	| { ok: true; as: 'grant'; grant: Grant; role: GrantRole }
	| { ok: true; as: 'anyone' }
	| {
			ok: false;
			/** Whether the asker may know it is there (a restricted item is listed; a private one isn't). */
			visible: boolean;
	  };

/** The grants in force on an item for this subject, the strongest role first. */
export function grantsFor(item: Guarded, subject: Subject, now = Date.now()): Grant[] {
	const creator = subject.owner ? creatorIdOf(subject.owner) : null;
	return item.grants
		.filter((g) => grantActive(g, now))
		.filter(
			(g) =>
				(g.target.kind === 'creator' && g.target.id === creator) ||
				(g.target.kind === 'collection' && g.target.id === subject.collection) ||
				(g.target.kind === 'room' && g.target.id === subject.room)
		)
		.sort((a, b) => (a.role === b.role ? 0 : a.role === 'collaborator' ? -1 : 1));
}

/** The rights a grant gives: a collection's carry the item to whoever starts it. */
function rightsOfGrant(grant: Grant): readonly LibraryRight[] {
	return grant.target.kind === 'collection' ? COLLECTION_RIGHTS : RIGHTS[grant.role];
}

/**
 * Decides one request. The owner may do anything; a grant in force for the
 * subject gives its role's rights; otherwise the access level says what
 * anyone may do.
 */
export function decide(
	item: Guarded,
	subject: Subject,
	right: LibraryRight,
	now = Date.now()
): Decision {
	if (subject.owner && subject.owner === item.owner) return { ok: true, as: 'owner' };
	const access: LibraryAccess = accessOf(item.listed, item.restricted);
	if (RIGHTS[access].includes(right)) return { ok: true, as: 'anyone' };
	const grants = grantsFor(item, subject, now);
	const grant = grants.find((g) => rightsOfGrant(g).includes(right));
	if (grant) return { ok: true, as: 'grant', grant, role: grant.role };
	return { ok: false, visible: access !== 'private' || grants.length > 0 };
}

/** The entitlement a decision records, when it rests on a grant. */
export function entitlementOf(item: string, decision: Decision): Entitlement | null {
	return decision.ok && decision.as === 'grant'
		? { item, grant: decision.grant.id, role: decision.role }
		: null;
}

/**
 * Whether a grant a story recorded still stands: the item is there and the
 * grant is in force (whom it was for was settled when the story started).
 * What the grant is now, for a caller that needs its role or target.
 */
export function stillHolds(
	item: Guarded | null,
	entitlement: Entitlement,
	now = Date.now()
): Grant | null {
	const grant = item?.grants.find((g) => g.id === entitlement.grant);
	return grant && grantActive(grant, now) ? grant : null;
}
