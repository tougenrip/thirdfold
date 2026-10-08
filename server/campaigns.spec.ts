import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import './rules';
import { DND_PREGENS } from '../src/lib/rules/dnd55e/pregens';
import { FileCampaignStore, MemoryCampaignStore } from './campaign-store';
import { campaignStoreSuite, sampleCampaign } from './campaign-store.suite';
import {
	campaignSummary,
	campaignView,
	changeRoster,
	closeStory,
	newCampaign,
	readCampaign,
	type StoryResult
} from './campaigns';
import { findRuleset } from './rules/ruleset';

const owner = 'a'.repeat(64);
const DND = { id: 'dnd-5.5e', version: 1 };
const progression = findRuleset(DND)!.progression!;
const builder = findRuleset(DND)!.builder!;

function built(i: number, id: string) {
	const b = builder.build(DND_PREGENS[i].choices, id);
	if (!b.ok) throw new Error(b.problems.join('; '));
	return b.saved;
}

const story = (over: Partial<StoryResult> = {}): StoryResult => ({
	title: 'The Hillside Shrine',
	adventure: { builtIn: 'hillside' },
	startedAt: new Date(0).toISOString(),
	outcome: 'complete',
	ending: 'Rest in peace',
	rewards: ['The shrine’s blessing'],
	members: ['pc-1'],
	characters: [{ id: 'pc-1', saved: built(0, 'pc-1'), dead: false, player: 'Ana' }],
	...over
});

describe('campaigns', () => {
	it('begins under rules that carry characters, pinned to their content', () => {
		const made = newCampaign(owner, '  The   Long Road ', DND);
		expect(made.ok).toBe(true);
		if (!made.ok) return;
		expect(made.record.name).toBe('The Long Road');
		expect(made.record.content.map((c) => c.id)).toEqual(['srd-5.2.1']);
		expect(readCampaign(JSON.parse(JSON.stringify(made.record)))).toEqual(made);
		expect(newCampaign(owner, '', DND).ok).toBe(false);
		expect(newCampaign(owner, 'Classic', { id: 'thirdfold-classic', version: 1 })).toMatchObject({
			ok: false,
			message: expect.stringContaining('carry no characters')
		});
		expect(newCampaign(owner, 'Nowhere', { id: 'dnd-5.5e', version: 9 }).ok).toBe(false);
	});

	it('reads back only what it wrote: unknown fields, ids and characters are checked', () => {
		const record = sampleCampaign(owner, 'Checked');
		expect(readCampaign({ ...record, extra: 1 }).ok).toBe(false);
		expect(readCampaign({ ...record, version: 2 }).ok).toBe(false);
		expect(
			readCampaign({ ...record, roster: [{ ...record.roster[0], id: 'pc-2' }] })
		).toMatchObject({
			ok: false,
			message: expect.stringContaining("rules don't read")
		});
		expect(readCampaign({ ...record, roster: [{ ...record.roster[0], status: 'lost' }] }).ok).toBe(
			false
		);
	});

	it('returns a finished adventure: history, a full rest, a level and the gear kept', () => {
		const record = sampleCampaign(owner, 'Onward');
		const hurt = structuredClone(built(0, 'pc-1')) as {
			character: { state: { hp: number; hitDiceSpent: number } };
		};
		hurt.character.state.hp = 3;
		hurt.character.state.hitDiceSpent = 1;
		const closed = closeStory(
			record,
			story({ characters: [{ id: 'pc-1', saved: hurt, dead: false, player: 'Ana' }] }),
			true
		);
		expect(closed.ok).toBe(true);
		if (!closed.ok) return;
		const { record: next, lines } = closed.returned;
		expect(lines).toEqual(['Brakka reaches level 2: Orc Fighter 2 (Soldier).']);
		const brakka = next.roster[0];
		expect(brakka).toMatchObject({ status: 'active', adventures: 1 });
		expect(progression.describe(brakka.saved)).toMatchObject({ level: 2 });
		const state = (brakka.saved as { character: { state: { hp: number; hitDiceSpent: number } } })
			.character.state;
		expect(state.hitDiceSpent).toBe(0);
		const back = builder.restore(brakka.saved, 'pc-1');
		expect(back.ok && state.hp).toBe(back.ok ? back.def.hp : -1);
		expect(state.hp).toBe(20);
		expect(next.history).toEqual([
			expect.objectContaining({
				title: 'The Hillside Shrine',
				outcome: 'complete',
				characters: [{ id: 'pc-1', name: 'Brakka', fate: 'alive', level: 1, advancedTo: 2 }]
			})
		]);
		expect(next.rewards).toEqual(['The shrine’s blessing']);
		expect(campaignView(next).roster[0]).toMatchObject({
			name: 'Brakka',
			level: 2,
			title: 'Orc Fighter 2 (Soldier)'
		});
		expect(campaignSummary(next)).toMatchObject({ characters: 1, adventures: 1 });
		expect(readCampaign(JSON.parse(JSON.stringify(next))).ok).toBe(true);
	});

	it('advances nobody on a defeat or when the GM says not to, and remembers the fallen', () => {
		const record = sampleCampaign(owner, 'Grief');
		const lost = closeStory(
			record,
			story({
				outcome: 'defeat',
				characters: [{ id: 'pc-1', saved: built(0, 'pc-1'), dead: true, player: 'Ana' }]
			}),
			true
		);
		expect(lost.ok && lost.returned.record.roster[0].status).toBe('dead');
		const held = closeStory(record, story(), false);
		expect(held.ok && progression.describe(held.returned.record.roster[0].saved)?.level).toBe(1);
	});

	it('puts characters met on the way on the roster, waiting, under ids of their own', () => {
		const record = sampleCampaign(owner, 'Company');
		const closed = closeStory(
			record,
			story({
				characters: [
					{ id: 'pc-1', saved: built(0, 'pc-1'), dead: false, player: 'Ana' },
					// Built in the story under an id the roster already has.
					{ id: 'pc-1x', saved: null, dead: false, player: null },
					{ id: 'wren', saved: built(1, 'wren'), dead: false, player: 'Bo' }
				]
			}),
			false
		);
		expect(closed.ok).toBe(true);
		if (!closed.ok) return;
		const roster = closed.returned.record.roster;
		expect(roster.map((e) => [e.id, e.status, e.player])).toEqual([
			['pc-1', 'active', 'Ana'],
			['pc-2', 'pending', 'Bo']
		]);
		expect(progression.describe(roster[1].saved)).toMatchObject({ id: 'pc-2', name: 'Wren' });
	});

	it('lets the GM approve, retire, restore and assign, within the rules of the roster', () => {
		let record = sampleCampaign(owner, 'Roster');
		record = {
			...record,
			roster: [
				...record.roster,
				{ id: 'pc-2', player: null, status: 'pending', adventures: 1, saved: built(1, 'pc-2') }
			]
		};
		const approve = changeRoster(record, { op: 'approve', character: 'pc-2' });
		expect(approve.ok && approve.record.roster[1].status).toBe('active');
		expect(changeRoster(record, { op: 'approve', character: 'pc-1' }).ok).toBe(false);
		const retired = changeRoster(record, { op: 'retire', character: 'pc-1' });
		expect(retired.ok && retired.record.roster[0].status).toBe('retired');
		if (!retired.ok) return;
		expect(changeRoster(retired.record, { op: 'restore', character: 'pc-1' }).ok).toBe(true);
		const assigned = changeRoster(record, { op: 'assign', character: 'pc-2', player: ' Bo ' });
		expect(assigned.ok && assigned.record.roster[1].player).toBe('Bo');
		expect(changeRoster(record, { op: 'retire', character: 'pc-9' }).ok).toBe(false);
	});
});

describe('MemoryCampaignStore', () => {
	campaignStoreSuite(() => new MemoryCampaignStore());
});

describe('FileCampaignStore', () => {
	const dirs: string[] = [];
	afterAll(async () => {
		for (const d of dirs) await rm(d, { recursive: true, force: true });
	});
	campaignStoreSuite(async () => {
		const dir = await mkdtemp(path.join(os.tmpdir(), 'thirdfold-campaigns-'));
		dirs.push(dir);
		return new FileCampaignStore(dir);
	});
});
