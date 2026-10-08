// What every campaign store does, run against each (memory, files, and live
// Supabase in supabase-scene-store.spec.ts). Not a spec file itself.

import { randomBytes } from 'node:crypto';
import { expect, it } from 'vitest';
import './rules';
import { DND_PREGENS } from '../src/lib/rules/dnd55e/pregens';
import { newCampaign, type CampaignRecord, type CampaignStore } from './campaigns';
import { findRuleset } from './rules/ruleset';

const hex64 = () => randomBytes(32).toString('hex');
const DND = { id: 'dnd-5.5e', version: 1 };

/** A campaign with one character on its roster. */
export function sampleCampaign(owner: string, name: string, at = new Date()): CampaignRecord {
	const made = newCampaign(owner, name, DND, at);
	if (!made.ok) throw new Error(made.message);
	const rules = findRuleset(DND)!;
	const built = rules.builder!.build(DND_PREGENS[0].choices, 'pc-1');
	if (!built.ok) throw new Error(built.problems.join('; '));
	return {
		...made.record,
		roster: [{ id: 'pc-1', player: 'Ana', status: 'active', adventures: 0, saved: built.saved }]
	};
}

export function campaignStoreSuite(make: () => CampaignStore | Promise<CampaignStore>): void {
	it('saves a campaign and reads it back checked, its character and all', async () => {
		const store = await make();
		const owner = hex64();
		const record = sampleCampaign(owner, 'The Salt Road');
		await store.save(record);
		expect(await store.get(record.id)).toEqual(record);
		await store.save({
			...record,
			name: 'The Salt Road, again',
			updatedAt: new Date().toISOString()
		});
		expect((await store.get(record.id))?.name).toBe('The Salt Road, again');
		expect(await store.get('0'.repeat(32))).toBeNull();
		expect(await store.get('../etc')).toBeNull();
		await store.remove(record.id, owner);
	});

	it('lists an owner’s campaigns only, latest first, and removes only the owner’s', async () => {
		const store = await make();
		const owner = hex64();
		const other = hex64();
		const a = sampleCampaign(owner, 'First', new Date(Date.now() - 60_000));
		const b = sampleCampaign(owner, 'Second');
		const c = sampleCampaign(other, 'Theirs');
		for (const r of [a, b, c]) await store.save(r);
		expect((await store.list(owner)).map((r) => r.name)).toEqual(['Second', 'First']);
		expect(await store.remove(c.id, owner)).toBe(false);
		expect(await store.get(c.id)).not.toBeNull();
		expect(await store.remove(a.id, owner)).toBe(true);
		expect((await store.list(owner)).map((r) => r.name)).toEqual(['Second']);
		await store.remove(b.id, owner);
		await store.remove(c.id, other);
	});

	it('refuses a damaged record rather than trusting half of it', async () => {
		const store = await make();
		const owner = hex64();
		const record = sampleCampaign(owner, 'Tampered');
		const saved = record.roster[0].saved as { character: { level: number } };
		await store.save({
			...record,
			roster: [
				{ ...record.roster[0], saved: { ...saved, character: { ...saved.character, level: 21 } } }
			]
		});
		expect(await store.get(record.id)).toBeNull();
		expect(await store.list(owner)).toEqual([]);
		await store.remove(record.id, owner).catch(() => undefined);
	});
}
