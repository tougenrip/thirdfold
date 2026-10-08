// Licence terms where they apply (milestone 59, docs/LICENSED.md): who may
// use an installed source, whether a story using one may be opened, and
// what a story or a file may not do with it. The game server asks these at
// each boundary (attach, load, continue, import, a restart, export,
// publish); everything here reads the installed source and the operator's
// licence store, never what a client says.

import type { LicenceUse } from '../../src/lib/content/licence';
import { diagnostic, type Diagnostic } from '../../src/lib/validation/diagnostics';
import { licenceUse } from '../adventure/persist';
import type { LicenceStore } from './licence-store';
import { installedSource, installedSources, type InstalledSource } from './sources';

export type MayUse = { ok: true; grant: string | null } | { ok: false; diagnostic: Diagnostic };

/** Whether a GM (by public creator id) may take an installed source up now, and the grant it rests on. */
export async function mayUse(
	store: LicenceStore,
	source: InstalledSource,
	creator: string | null
): Promise<MayUse> {
	const { file } = source;
	if ((await store.status(file.id))?.status === 'withdrawn')
		return {
			ok: false,
			diagnostic: diagnostic(
				'licence.withdrawn',
				'source',
				`${file.name} was withdrawn by ${file.publisher}.`
			)
		};
	if (file.terms.entitlement === 'open') return { ok: true, grant: null };
	const grant = creator ? await store.holding(file.id, creator) : null;
	return grant
		? { ok: true, grant: grant.id }
		: {
				ok: false,
				diagnostic: diagnostic(
					'licence.denied',
					'source',
					`${file.name} is licensed by ${file.publisher} only to GMs this server granted it to.`
				)
			};
}

/** The licensed sources a saved story uses, as saved (malformed ones are the story reader's to refuse). */
export function savedLicences(data: unknown): LicenceUse[] {
	const state = (data as { adventure?: { state?: { packs?: unknown } } } | null)?.adventure?.state;
	const packs = Array.isArray(state?.packs) ? state.packs : [];
	const out: LicenceUse[] = [];
	for (const p of packs) {
		const licensed = (p as { licensed?: unknown } | null)?.licensed;
		if (licensed === undefined) continue;
		try {
			out.push(licenceUse(licensed));
		} catch {
			// Damaged: the load refuses it.
		}
	}
	return out;
}

/**
 * Why a story using these licensed sources can't be opened by this GM, or
 * null: each must be installed as it was, not withdrawn under terms that
 * stop the stories using it, and still granted to them where a grant is
 * needed. A source withdrawn under `finish` lets a story under way go on.
 */
export async function openRefused(
	store: LicenceStore,
	uses: readonly LicenceUse[],
	creator: string | null
): Promise<Diagnostic | null> {
	for (const use of uses) {
		const source = installedSource(use.source);
		if (!source || source.file.version !== use.version || source.sha256 !== use.sha256)
			return diagnostic(
				'licence.missing',
				'adventure.packs',
				`This story uses licensed content (${use.source} ${use.version}) this server doesn't have as it was.`
			);
		const { file } = source;
		if ((await store.status(file.id))?.status === 'withdrawn' && file.terms.withdrawal === 'stop')
			return diagnostic(
				'licence.withdrawn',
				'adventure.packs',
				`${file.name} was withdrawn by ${file.publisher}, and stories using it stop.`
			);
		if (
			file.terms.entitlement === 'granted' &&
			!(creator && (await store.holding(file.id, creator)))
		)
			return diagnostic(
				'licence.denied',
				'adventure.packs',
				`This story uses ${file.name}, licensed by ${file.publisher} only to GMs this server granted it to.`
			);
	}
	return null;
}

/** Why a story using these sources can't leave this server as a file, or null. */
export function exportRefused(uses: readonly LicenceUse[]): Diagnostic | null {
	for (const use of uses) {
		const file = installedSource(use.source)?.file;
		if (!file || !file.terms.uses.export)
			return diagnostic(
				'licence.terms',
				'adventure.packs',
				`${file?.name ?? use.source}'s licence keeps stories using it on this server: save it here instead.`
			);
	}
	return null;
}

/** Ids of licensed content (`lc-…`) a file names. */
const LICENSED_IDS = /\blc-[0-9a-f]{16}\b/g;

/**
 * Why content to be published may not name what it names, or null: a
 * licensed source's content may be named only where its licence allows
 * references, and only by an id this server can trace to an installed source.
 */
export function referenceRefused(
	raw: unknown,
	packOf: (source: InstalledSource) => string | null
): Diagnostic | null {
	const text = JSON.stringify(raw ?? null);
	const ids = new Set(text.match(LICENSED_IDS) ?? []);
	if (!ids.size) return null;
	const known = new Map(
		installedSources().flatMap((s) => {
			const pack = packOf(s);
			return pack ? [[pack, s] as const] : [];
		})
	);
	for (const id of ids) {
		const source = known.get(id);
		if (!source || !source.file.terms.uses.reference)
			return diagnostic(
				'licence.terms',
				'file',
				source
					? `It names ${source.file.name}'s content, whose licence doesn't let published content name it.`
					: 'It names licensed content this server can’t trace to an installed source.'
			);
	}
	return null;
}
