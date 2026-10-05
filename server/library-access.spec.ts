import { describe, expect, it } from 'vitest';
import {
	accessOf,
	flagsOf,
	grantActive,
	parseGrant,
	parseNewGrant,
	type Grant
} from '../src/lib/game/access';
import { decide, entitlementOf, stillHolds, type Guarded } from './library-access';
import { creatorIdOf } from './library-store';

const OWNER = 'a'.repeat(64);
const ALICE = 'b'.repeat(64);
const BOB = 'c'.repeat(64);
const COLLECTION = 'd'.repeat(32);
const NOW = Date.parse('2026-10-05T12:00:00Z');

function grant(over: Partial<Grant> = {}): Grant {
	return {
		id: 'e'.repeat(32),
		target: { kind: 'creator', id: creatorIdOf(ALICE) },
		role: 'member',
		by: creatorIdOf(OWNER),
		at: '2026-10-01T00:00:00.000Z',
		expires: null,
		revoked: null,
		note: '',
		...over
	};
}

const item = (access: 'public' | 'restricted' | 'private', grants: Grant[] = []): Guarded => ({
	owner: OWNER,
	...flagsOf(access),
	grants
});

describe('access levels', () => {
	it('reads the stored flags as a level and back', () => {
		expect(accessOf(true, false)).toBe('public');
		expect(accessOf(true, true)).toBe('restricted');
		expect(accessOf(false, false)).toBe('private');
		expect(accessOf(false, true)).toBe('private');
		for (const a of ['public', 'restricted', 'private'] as const)
			expect(accessOf(flagsOf(a).listed, flagsOf(a).restricted)).toBe(a);
	});

	it('lets anyone list, read, play, include and export what is public, never publish or manage it', () => {
		const pub = item('public');
		for (const right of ['list', 'read', 'use', 'include', 'export'] as const)
			expect(decide(pub, { owner: BOB }, right, NOW)).toEqual({ ok: true, as: 'anyone' });
		expect(decide(pub, {}, 'use', NOW).ok).toBe(true);
		expect(decide(pub, { owner: BOB }, 'publish', NOW)).toEqual({ ok: false, visible: true });
		expect(decide(pub, { owner: BOB }, 'manage', NOW).ok).toBe(false);
	});

	it('lists restricted content for anyone but opens it only to its owner and grantees', () => {
		const r = item('restricted');
		expect(decide(r, { owner: BOB }, 'list', NOW).ok).toBe(true);
		for (const right of ['read', 'use', 'include', 'export'] as const)
			expect(decide(r, { owner: BOB }, right, NOW)).toEqual({ ok: false, visible: true });
		for (const right of ['read', 'use', 'include', 'export', 'publish', 'manage'] as const)
			expect(decide(r, { owner: OWNER }, right, NOW)).toEqual({ ok: true, as: 'owner' });
	});

	it('keeps private content from everyone without a grant, not even saying it is there', () => {
		const p = item('private');
		for (const right of ['list', 'read', 'use'] as const)
			expect(decide(p, { owner: BOB }, right, NOW)).toEqual({ ok: false, visible: false });
		expect(decide(p, {}, 'list', NOW)).toEqual({ ok: false, visible: false });
		expect(decide(p, { owner: OWNER }, 'use', NOW).ok).toBe(true);
	});
});

describe('grants', () => {
	it('gives a member list, read and play, and nothing more', () => {
		const p = item('private', [grant()]);
		for (const right of ['list', 'read', 'use'] as const) {
			const d = decide(p, { owner: ALICE }, right, NOW);
			expect(d).toMatchObject({ ok: true, as: 'grant', role: 'member' });
		}
		for (const right of ['include', 'export', 'publish', 'manage'] as const)
			expect(decide(p, { owner: ALICE }, right, NOW)).toEqual({ ok: false, visible: true });
		// Only the creator it names.
		expect(decide(p, { owner: BOB }, 'use', NOW).ok).toBe(false);
	});

	it('gives a collaborator everything but managing it', () => {
		const p = item('restricted', [grant({ role: 'collaborator' })]);
		for (const right of ['read', 'use', 'include', 'export', 'publish'] as const)
			expect(decide(p, { owner: ALICE }, right, NOW).ok).toBe(true);
		expect(decide(p, { owner: ALICE }, 'manage', NOW).ok).toBe(false);
	});

	it('lets a collection carry what it was granted, to whoever starts it', () => {
		const g = grant({ target: { kind: 'collection', id: COLLECTION } });
		const r = item('restricted', [g]);
		expect(decide(r, { collection: COLLECTION }, 'include', NOW).ok).toBe(true);
		expect(decide(r, { owner: BOB, collection: COLLECTION }, 'use', NOW).ok).toBe(true);
		expect(decide(r, { owner: BOB, collection: COLLECTION }, 'export', NOW).ok).toBe(false);
		expect(decide(r, { owner: BOB }, 'use', NOW).ok).toBe(false);
		expect(decide(r, { collection: 'f'.repeat(32) }, 'include', NOW).ok).toBe(false);
	});

	it('lets a table play what was granted to its room, for as long as the grant runs', () => {
		const g = grant({
			target: { kind: 'room', id: 'ABC234' },
			expires: '2026-10-05T18:00:00.000Z'
		});
		const p = item('private', [g]);
		expect(decide(p, { room: 'ABC234' }, 'use', NOW).ok).toBe(true);
		expect(decide(p, { room: 'ABC235' }, 'use', NOW).ok).toBe(false);
		expect(decide(p, { room: 'ABC234' }, 'use', Date.parse('2026-10-05T19:00:00Z')).ok).toBe(false);
	});

	it('stops a revoked or lapsed grant', () => {
		expect(grantActive(grant(), NOW)).toBe(true);
		expect(grantActive(grant({ revoked: '2026-10-04T00:00:00.000Z' }), NOW)).toBe(false);
		expect(grantActive(grant({ expires: '2026-10-05T11:59:59.000Z' }), NOW)).toBe(false);
		const p = item('private', [grant({ revoked: '2026-10-04T00:00:00.000Z' })]);
		expect(decide(p, { owner: ALICE }, 'use', NOW).ok).toBe(false);
	});

	it('names the grant a story rests on, and says whether it still holds', () => {
		const g = grant();
		const p = item('private', [g]);
		const d = decide(p, { owner: ALICE }, 'use', NOW);
		const e = entitlementOf('9'.repeat(32), d)!;
		expect(e).toEqual({ item: '9'.repeat(32), grant: g.id, role: 'member' });
		expect(entitlementOf('x', decide(item('public'), {}, 'use', NOW))).toBeNull();
		expect(stillHolds(p, e, NOW)).toEqual(g);
		expect(stillHolds(item('private', [{ ...g, revoked: g.at }]), e, NOW)).toBeNull();
		expect(stillHolds(item('private', [{ ...g, expires: g.at }]), e, NOW)).toBeNull();
		expect(stillHolds(item('private'), e, NOW)).toBeNull();
		expect(stillHolds(null, e, NOW)).toBeNull();
	});
});

describe('asking for a grant', () => {
	it('takes a creator, a collection or a table, with a role', () => {
		const ok = parseNewGrant({
			target: { kind: 'creator', id: '0123456789abcdef' },
			role: 'member'
		});
		expect(ok).toEqual({
			ok: true,
			grant: { target: { kind: 'creator', id: '0123456789abcdef' }, role: 'member' }
		});
		expect(
			parseNewGrant({ target: { kind: 'collection', id: COLLECTION }, role: 'member', note: ' x ' })
		).toMatchObject({ ok: true, grant: { note: 'x' } });
	});

	it('gives a table a grant that runs out within a day', () => {
		const room = parseNewGrant({ target: { kind: 'room', id: 'ABC234' }, role: 'member' });
		expect(room).toMatchObject({ ok: true, grant: { hours: 24 } });
		expect(
			parseNewGrant({ target: { kind: 'room', id: 'ABC234' }, role: 'member', hours: 25 }).ok
		).toBe(false);
	});

	it('refuses what is not a grant', () => {
		const bad = [
			null,
			{ target: { kind: 'creator', id: 'nope' }, role: 'member' },
			{ target: { kind: 'creator', id: '0123456789abcdef' }, role: 'owner' },
			{ target: { kind: 'room', id: 'ABC234' }, role: 'collaborator' },
			{ target: { kind: 'collection', id: COLLECTION }, role: 'collaborator' },
			{ target: { kind: 'creator', id: '0123456789abcdef' }, role: 'member', hours: 0 },
			{ target: { kind: 'creator', id: '0123456789abcdef' }, role: 'member', extra: 1 },
			{ target: { kind: 'creator', id: '0123456789abcdef', more: 1 }, role: 'member' },
			{ target: { kind: 'creator', id: '0123456789abcdef' }, role: 'member', note: 'x'.repeat(121) }
		];
		for (const raw of bad) expect(parseNewGrant(raw).ok).toBe(false);
	});

	it('reads a stored grant back only whole', () => {
		const g = grant();
		expect(parseGrant(JSON.parse(JSON.stringify(g)))).toEqual(g);
		expect(parseGrant({ ...g, id: 'short' })).toBeNull();
		expect(parseGrant({ ...g, at: 'yesterday' })).toBeNull();
		expect(parseGrant({ ...g, role: 'owner' })).toBeNull();
	});
});
