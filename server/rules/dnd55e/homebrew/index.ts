// The fifth edition rules' content packs (the ruleset contract's `packs`):
// homebrew packs read by pack.ts, held by registry.ts, listed for a table.

import type { ContentPackListing, PackAccess } from '../../../../src/lib/adventure/adventure';
import { packOfId } from '../../../../src/lib/rules/dnd55e/homebrew';
import type { ContentPacks, JsonData } from '../../ruleset';
import type { Catalog } from '../catalog';
import { readPack } from './pack';
import { heldLicence, heldPack, holdPack, HOMEBREW_KIND } from './registry';

export function dndPacks(catalog: () => Catalog): ContentPacks {
	return {
		hold(raw) {
			const read = readPack(raw, catalog());
			if (!read.ok) return read;
			holdPack(read.loaded);
			return { ok: true, id: read.loaded.id };
		},
		holdLicensed({ file, content }) {
			if (file.rules.id !== 'dnd-5.5e' || file.rules.version !== 1)
				return { ok: false, problems: [`it is for ${file.rules.id} v${file.rules.version}`] };
			const read = readPack(content, catalog(), {
				source: `${file.id}@${file.version}`,
				display: file.terms.display,
				trademarks: file.trademarks
			});
			if (!read.ok) return read;
			holdPack(read.loaded, file);
			return { ok: true, id: read.loaded.id };
		},
		listing(id: string, access: PackAccess): ContentPackListing | null {
			const held = heldPack(id);
			if (!held) return null;
			const { pack } = held;
			const licensed = heldLicence(id);
			// A licensed source lists as its publisher names it, with its credit and terms.
			return {
				id,
				name: licensed?.name ?? pack.name,
				version: licensed?.version ?? pack.version,
				creator: licensed?.publisher ?? pack.creator ?? null,
				license: licensed?.terms.licence.name ?? pack.license ?? null,
				about: licensed?.about ?? pack.about ?? null,
				records: held.records.map((r) => ({ kind: r.kind, id: r.id, name: r.name })),
				access: { ...access },
				source: licensed ? 'licensed' : 'homebrew',
				licensed: licensed
					? {
							source: licensed.id,
							publisher: licensed.publisher,
							attribution: licensed.attribution,
							terms: structuredClone(licensed.terms)
						}
					: null
			};
		},
		// A licensed source's content is never written into a save: the story keeps a reference.
		content: (id) =>
			heldLicence(id) ? null : ((heldPack(id)?.pack as unknown as JsonData) ?? null),
		packOf: (id) => packOfId(id) ?? HOMEBREW_KIND.exec(id)?.[1] ?? null
	};
}
