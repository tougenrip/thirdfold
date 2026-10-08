import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe } from 'vitest';
import { FileLicenceStore, MemoryLicenceStore } from './licence-store';
import { licenceStoreSuite } from './licence-store.suite';

describe('MemoryLicenceStore', () => {
	licenceStoreSuite(() => new MemoryLicenceStore());
});

describe('FileLicenceStore', () => {
	const dirs: string[] = [];
	afterAll(async () => {
		for (const d of dirs) await rm(d, { recursive: true, force: true });
	});
	licenceStoreSuite(async () => {
		const dir = await mkdtemp(path.join(os.tmpdir(), 'thirdfold-licences-'));
		dirs.push(dir);
		return new FileLicenceStore(dir);
	});
});
