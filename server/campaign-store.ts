// Where campaigns are kept (milestone 58): a JSON file each (`CAMPAIGNS_DIR`,
// default data/campaigns), written then renamed so a crash never leaves half
// a campaign, or Supabase's `public.campaigns` (supabase/migrations), which
// only the game server's service key can touch. Every record read back goes
// through `readCampaign`.

import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@supabase/supabase-js';
import { CAMPAIGN_ID_PATTERN } from '../src/lib/game/campaign';
import { readCampaign, type CampaignRecord, type CampaignStore } from './campaigns';

function checked(raw: unknown, label: string): CampaignRecord | null {
	const r = readCampaign(raw);
	if (r.ok) return r.record;
	console.warn(`[campaigns] ${label} is damaged: ${r.message}`);
	return null;
}

const latestFirst = (a: CampaignRecord, b: CampaignRecord) =>
	b.updatedAt.localeCompare(a.updatedAt);

export class FileCampaignStore implements CampaignStore {
	constructor(private readonly dir: string) {}

	async save(record: CampaignRecord): Promise<void> {
		await mkdir(this.dir, { recursive: true });
		const file = this.file(record.id);
		const tmp = `${file}.${process.pid}.tmp`;
		await writeFile(tmp, JSON.stringify(record), 'utf8');
		await rename(tmp, file);
	}

	async get(id: string): Promise<CampaignRecord | null> {
		if (!CAMPAIGN_ID_PATTERN.test(id)) return null;
		try {
			return checked(JSON.parse(await readFile(this.file(id), 'utf8')), id);
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
			throw err;
		}
	}

	async list(owner: string): Promise<CampaignRecord[]> {
		let names: string[];
		try {
			names = await readdir(this.dir);
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
			throw err;
		}
		const out: CampaignRecord[] = [];
		for (const name of names) {
			const id = name.replace(/\.json$/, '');
			if (!name.endsWith('.json') || !CAMPAIGN_ID_PATTERN.test(id)) continue;
			const record = await this.get(id).catch(() => null);
			if (record?.owner === owner) out.push(record);
		}
		return out.sort(latestFirst);
	}

	async remove(id: string, owner: string): Promise<boolean> {
		const record = await this.get(id);
		if (!record || record.owner !== owner) return false;
		await rm(this.file(id), { force: true });
		return true;
	}

	private file(id: string): string {
		if (!CAMPAIGN_ID_PATTERN.test(id)) throw new Error('Invalid campaign id');
		return path.join(this.dir, `${id}.json`);
	}
}

/** Campaigns in Supabase Postgres (`public.campaigns`: RLS on, nothing granted to browser roles). */
export class SupabaseCampaignStore implements CampaignStore {
	constructor(private readonly db: SupabaseClient) {}

	static connect(url: string, serviceKey: string): SupabaseCampaignStore {
		return new SupabaseCampaignStore(
			createClient(url, serviceKey, {
				auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
			})
		);
	}

	async save(record: CampaignRecord): Promise<void> {
		if (!CAMPAIGN_ID_PATTERN.test(record.id)) throw new Error('Invalid campaign id');
		const { error } = await this.db.from('campaigns').upsert({
			id: record.id,
			owner: record.owner,
			data: record,
			updated_at: record.updatedAt
		});
		if (error) throw new Error(`Saving a campaign failed: ${error.message}`);
	}

	async get(id: string): Promise<CampaignRecord | null> {
		if (!CAMPAIGN_ID_PATTERN.test(id)) return null;
		const { data, error } = await this.db
			.from('campaigns')
			.select('data')
			.eq('id', id)
			.maybeSingle();
		if (error) throw new Error(`Reading a campaign failed: ${error.message}`);
		return data ? checked((data as { data: unknown }).data, id) : null;
	}

	async list(owner: string): Promise<CampaignRecord[]> {
		const { data, error } = await this.db
			.from('campaigns')
			.select('id, data')
			.eq('owner', owner)
			.order('updated_at', { ascending: false });
		if (error) throw new Error(`Listing campaigns failed: ${error.message}`);
		return (data ?? [])
			.map((row) => checked((row as { data: unknown }).data, (row as { id: string }).id))
			.filter((r): r is CampaignRecord => r !== null && r.owner === owner);
	}

	async remove(id: string, owner: string): Promise<boolean> {
		if (!CAMPAIGN_ID_PATTERN.test(id)) return false;
		const { data, error } = await this.db
			.from('campaigns')
			.delete()
			.eq('id', id)
			.eq('owner', owner)
			.select('id');
		if (error) throw new Error(`Removing a campaign failed: ${error.message}`);
		return (data ?? []).length > 0;
	}
}

/** For tests and throwaway servers; kept as JSON so nothing is shared by reference. */
export class MemoryCampaignStore implements CampaignStore {
	readonly records = new Map<string, string>();
	async save(record: CampaignRecord): Promise<void> {
		this.records.set(record.id, JSON.stringify(record));
	}
	async get(id: string): Promise<CampaignRecord | null> {
		const text = this.records.get(id);
		return text ? checked(JSON.parse(text), id) : null;
	}
	async list(owner: string): Promise<CampaignRecord[]> {
		return [...this.records.keys()]
			.map((id) => checked(JSON.parse(this.records.get(id)!), id))
			.filter((r): r is CampaignRecord => r !== null && r.owner === owner)
			.sort(latestFirst);
	}
	async remove(id: string, owner: string): Promise<boolean> {
		const r = await this.get(id);
		if (!r || r.owner !== owner) return false;
		return this.records.delete(id);
	}
}
