// What every licence store does, run against each (memory, files, and live
// Supabase in supabase-scene-store.spec.ts). Not a spec file itself.

import { randomBytes } from 'node:crypto';
import { expect, it } from 'vitest';
import type { LicenceStore } from './licence-store';

const creator = () => randomBytes(8).toString('hex');
/** A source id of its own per run, so a shared database never mixes runs. */
const source = () => `test-source-${randomBytes(4).toString('hex')}`;

export function licenceStoreSuite(make: () => LicenceStore | Promise<LicenceStore>): void {
	it('grants a source to a creator, finds the grant in force, and revokes it for good', async () => {
		const store = await make();
		const src = source();
		const who = creator();
		expect(await store.holding(src, who)).toBeNull();
		const grant = await store.grant(src, who, { by: 'Operator', note: 'Agreement 7' });
		expect(grant).toMatchObject({
			source: src,
			creator: who,
			by: 'Operator',
			revoked: null,
			expires: null
		});
		expect((await store.holding(src, who))?.id).toBe(grant.id);
		expect(await store.holding(src, creator())).toBeNull();
		expect((await store.get(grant.id))?.note).toBe('Agreement 7');
		expect(await store.revoke(grant.id)).toBe(true);
		expect(await store.revoke(grant.id)).toBe(false);
		expect(await store.holding(src, who)).toBeNull();
		// Revoked, never forgotten.
		const kept = await store.grants(src);
		expect(kept.map((g) => g.id)).toEqual([grant.id]);
		expect(kept[0].revoked).not.toBeNull();
	});

	it('lets a grant run out', async () => {
		const store = await make();
		const src = source();
		const who = creator();
		const then = new Date(Date.now() - 3 * 86_400_000);
		await store.grant(src, who, { by: 'Operator', days: 1 }, then);
		expect(await store.holding(src, who)).toBeNull();
		await store.grant(src, who, { by: 'Operator', days: 30 });
		expect(await store.holding(src, who)).not.toBeNull();
		await expect(store.grant(src, 'not-a-creator', { by: 'Operator' })).rejects.toThrow();
	});

	it('keeps a source withdrawn or active, as its operator set it', async () => {
		const store = await make();
		const src = source();
		expect(await store.status(src)).toBeNull();
		await store.setStatus(src, 'withdrawn', 'The publisher asked.');
		expect(await store.status(src)).toMatchObject({
			status: 'withdrawn',
			note: 'The publisher asked.'
		});
		await store.setStatus(src, 'active', '');
		expect((await store.status(src))?.status).toBe('active');
	});
}
