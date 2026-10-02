// The fifth edition rules' content packs (the ruleset contract's `packs`):
// homebrew packs read by pack.ts, held by registry.ts, listed for a table.

import type { ContentPackListing, PackAccess } from '../../../../src/lib/adventure/adventure';
import { packOfId } from '../../../../src/lib/rules/dnd55e/homebrew';
import type { ContentPacks, JsonData } from '../../ruleset';
import type { Catalog } from '../catalog';
import { readPack } from './pack';
import { heldPack, holdPack, HOMEBREW_KIND } from './registry';

export function dndPacks(catalog: () => Catalog): ContentPacks {
	return {
		hold(raw) {
			const read = readPack(raw, catalog());
			if (!read.ok) return read;
			holdPack(read.loaded);
			return { ok: true, id: read.loaded.id };
		},
		listing(id: string, access: PackAccess): ContentPackListing | null {
			const held = heldPack(id);
			if (!held) return null;
			const { pack } = held;
			return {
				id,
				name: pack.name,
				version: pack.version,
				creator: pack.creator ?? null,
				license: pack.license ?? null,
				about: pack.about ?? null,
				records: held.records.map((r) => ({ kind: r.kind, id: r.id, name: r.name })),
				access: { ...access }
			};
		},
		content: (id) => (heldPack(id)?.pack as unknown as JsonData) ?? null,
		packOf: (id) => packOfId(id) ?? HOMEBREW_KIND.exec(id)?.[1] ?? null
	};
}
