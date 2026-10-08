import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import '../rules';
import type { LicenceTerms, LicenceUse } from '../../src/lib/content/licence';
import { parseSceneFile } from '../../src/lib/game/scene-file';
import { attachLicensed, startAdventure } from '../adventure/engine';
import { readAdventure, saveAdventure } from '../adventure/persist';
import { RoomManager } from '../rooms';
import { dnd55e } from '../rules/dnd55e';
import { exportScene } from '../scene-io';
import { MemoryLicenceStore } from './licence-store';
import { exportRefused, mayUse, openRefused, referenceRefused } from './policy';
import {
	forgetSources,
	installedSource,
	installSource,
	installSources,
	type InstalledSource
} from './sources';

const CREATOR = '0123456789abcdef';
let base: InstalledSource;

/** The hypothetical source again, under other terms and its own id. */
function variant(id: string, terms: Partial<LicenceTerms>): InstalledSource {
	const source: InstalledSource = {
		...base,
		file: { ...base.file, id, terms: { ...base.file.terms, ...terms } }
	};
	installSource(source);
	return source;
}
const use = (s: InstalledSource): LicenceUse => ({
	source: s.file.id,
	version: s.file.version,
	sha256: s.sha256,
	grant: null
});

beforeEach(() => {
	forgetSources();
	installSources(path.resolve('content/licensed-example'));
	base = installedSource('clockwork-arsenal')!;
});

describe('who may use a licensed source', () => {
	it('an open source anyone; a granted one only its grantees; a withdrawn one nobody', async () => {
		const store = new MemoryLicenceStore();
		const open = variant('open-arsenal', { entitlement: 'open' });
		expect(await mayUse(store, open, null)).toEqual({ ok: true, grant: null });
		expect(await mayUse(store, base, CREATOR)).toMatchObject({
			ok: false,
			diagnostic: { code: 'licence.denied' }
		});
		const grant = await store.grant('clockwork-arsenal', CREATOR, { by: 'Operator' });
		expect(await mayUse(store, base, CREATOR)).toEqual({ ok: true, grant: grant.id });
		await store.setStatus('clockwork-arsenal', 'withdrawn', '');
		expect(await mayUse(store, base, CREATOR)).toMatchObject({
			ok: false,
			diagnostic: { code: 'licence.withdrawn' }
		});
	});

	it('opens a story under way after a withdrawal only where the terms let it finish', async () => {
		const store = new MemoryLicenceStore();
		const stop = variant('stop-arsenal', { entitlement: 'open', withdrawal: 'stop' });
		const finish = variant('finish-arsenal', { entitlement: 'open', withdrawal: 'finish' });
		for (const id of ['stop-arsenal', 'finish-arsenal']) await store.setStatus(id, 'withdrawn', '');
		expect(await openRefused(store, [use(stop)], CREATOR)).toMatchObject({
			code: 'licence.withdrawn'
		});
		expect(await openRefused(store, [use(finish)], CREATOR)).toBeNull();
		// Changed or missing content is refused.
		expect(
			await openRefused(store, [{ ...use(finish), sha256: 'f'.repeat(64) }], CREATOR)
		).toMatchObject({
			code: 'licence.missing'
		});
		expect(
			await openRefused(store, [{ ...use(finish), source: 'gone-arsenal' }], CREATOR)
		).toMatchObject({ code: 'licence.missing' });
	});

	it('lets a story leave as a file, and published content name it, only where the terms say', () => {
		const exportable = variant('export-arsenal', { uses: { export: true, reference: true } });
		expect(exportRefused([use(base)])).toMatchObject({ code: 'licence.terms' });
		expect(exportRefused([use(exportable)])).toBeNull();
		const packOf = (s: InstalledSource) => {
			const held = dnd55e.packs!.holdLicensed!({ file: s.file, content: s.content });
			return held.ok ? held.id : null;
		};
		const strict = packOf(base)!;
		const loose = packOf(exportable)!;
		expect(referenceRefused({ monsters: [`${strict}-brass-hound`] }, packOf)).toMatchObject({
			code: 'licence.terms'
		});
		expect(referenceRefused({ monsters: [`${loose}-brass-hound`] }, packOf)).toBeNull();
		expect(referenceRefused({ monsters: ['lc-0000000000000000-x'] }, packOf)).toMatchObject({
			message: expect.stringContaining('can’t trace')
		});
		expect(referenceRefused({ monsters: ['srd-goblin'] }, packOf)).toBeNull();
	});
});

describe('a story with a licensed source', () => {
	it('keeps a reference in its save, its credit with it, and reads back only from the installed source', () => {
		const rooms = new RoomManager();
		const created = rooms.create('Gia');
		if (!created.ok) throw new Error('no room');
		const { room, player: gm } = created;
		room.dice = () => 10;
		expect(startAdventure(room, gm, 'barrow').ok).toBe(true);
		const attached = attachLicensed(room, gm, base, 'a'.repeat(32));
		expect(attached.ok && attached.log.map((m) => m.kind === 'system' && m.text)).toEqual([
			'The GM brings licensed content to the story: Clockwork Arsenal 1.0, by Example Press.',
			base.file.attribution
		]);
		expect(attachLicensed(room, gm, base, null)).toMatchObject({ ok: false, code: 'forbidden' });
		const saved = saveAdventure(room.adventure!) as unknown as {
			state: { packs: unknown[]; credits: string[] };
		};
		expect(saved.state.packs).toEqual([
			{
				owner: null,
				licensed: {
					source: 'clockwork-arsenal',
					version: '1.0',
					sha256: base.sha256,
					grant: 'a'.repeat(32)
				}
			}
		]);
		expect(saved.state.credits).toEqual([
			expect.stringContaining('SRD 5.2.1'),
			base.file.attribution
		]);
		const scene = parseSceneFile(JSON.parse(JSON.stringify(exportScene(room, 'Arsenal'))));
		if (!scene.ok) throw new Error(scene.error);
		const back = readAdventure(saved as never, scene.scene);
		expect(back.ok && back.adventure.packs).toEqual(room.adventure!.packs);
		// Not installed here: the story can't come back.
		forgetSources();
		expect(readAdventure(saved as never, scene.scene)).toMatchObject({
			ok: false,
			error: expect.stringContaining('licensed content clockwork-arsenal')
		});
	});
});
