// One validator for everything a creator or a GM hands the server
// (milestone 56, src/lib/validation/diagnostics.ts): an adventure file, a
// homebrew pack, a collection, a character a player builds, a saved table.
// Each is checked the way it will be used (an adventure under the rules it
// names, a pack by its rules against the SRD it pins, a collection against
// the library as its creator may use it, a save with its story, its lock
// and the grants it rests on) and every finding comes back as a diagnostic
// with a stable code and a path. The same checks run when the builder asks
// (`content_validate`) and on import, publish, load and session start,
// where a refusal carries them.

import { COLLECTION_FILE_MAX_BYTES, CONTENT_PACK_MAX_BYTES } from '../src/lib/game/file-limits';
import { parseCollectionFile, type CollectionFile } from '../src/lib/game/collection';
import { parseEntitlements, type Entitlement } from '../src/lib/game/access';
import { parseSceneFile, SCENE_FILE_VERSION } from '../src/lib/game/scene-file';
import {
	diagnostic,
	fromProblem,
	validationOf,
	VALIDATORS,
	type Diagnostic,
	type DiagnosticCode,
	type Validation
} from '../src/lib/validation/diagnostics';
import { readAdventure } from './adventure/persist';
import { loadServerAdventure } from './adventure/rules-content';
import { resolveCollection, withRules, type Shelves } from './collections';
import { stillHolds } from './library-access';
import { creatorIdOf } from './library-store';
import type { LicenceStore } from './licensed/licence-store';
import { openRefused, savedLicences } from './licensed/policy';
import { findRuleset } from './rules/ruleset';

/** What a check may consult: the library and saved tables, and who asks. */
export interface ValidateContext {
	shelves: Shelves;
	/** The asker's GM key hash, when they sent a key. */
	owner: string | null;
	/** For a collection already in the library: its id (what it may include depends on it). */
	collection?: string | null;
	/** Who may use which licensed source (milestone 59): a save is checked against it too. */
	licences?: LicenceStore;
}

type Raw = Record<string, unknown>;
const isObject = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);
const sizeOf = (v: unknown) => {
	try {
		return JSON.stringify(v).length;
	} catch {
		return Infinity;
	}
};
const formatOf = (raw: unknown, field: string) =>
	isObject(raw) && typeof raw[field] === 'number' && Number.isInteger(raw[field])
		? (raw[field] as number)
		: null;

/** Checks one piece of content. */
export async function validateContent(
	kind: Validation['kind'],
	raw: unknown,
	ctx: ValidateContext
): Promise<Validation> {
	switch (kind) {
		case 'adventure':
			return validateAdventureFile(raw);
		case 'pack':
			return validatePack(raw);
		case 'collection':
			return validateCollection(raw, ctx);
		case 'character':
			return validateCharacter(raw);
		case 'save':
			return validateSave(raw, ctx);
	}
}

/**
 * An adventure file: its shape and every field, its story, and what its
 * rules make of it (its party, its monsters, rests, gear, checks and saves).
 */
export function validateAdventureFile(raw: unknown): Validation {
	const loaded = loadServerAdventure(raw, 'custom-validate');
	if (loaded.ok) return validationOf('adventure', [], loaded.file.version);
	return validationOf('adventure', loaded.diagnostics, loaded.format);
}

/** The code of a problem a homebrew pack's reader words. */
function packCode(problem: string): DiagnosticCode {
	if (problem.endsWith('not a field of a pack')) return 'schema.unknown_field';
	if (problem.endsWith('no markup, templates or code')) return 'content.markup';
	if (/the SRD already has a /.test(problem)) return 'content.srd_name';
	return 'schema.value';
}

/** A homebrew pack: its rules, then every record against the SRD it pins. */
export function validatePack(raw: unknown): Validation {
	const format = formatOf(raw, 'formatVersion');
	if (sizeOf(raw) > CONTENT_PACK_MAX_BYTES)
		return validationOf(
			'pack',
			[diagnostic('schema.value', 'file', `at most ${CONTENT_PACK_MAX_BYTES / 1024} KB`)],
			format
		);
	if (format !== null && format > Math.max(...VALIDATORS.pack.reads))
		return validationOf(
			'pack',
			[
				diagnostic(
					'format.newer',
					'formatVersion',
					`version ${format}; this server reads homebrew up to version ${Math.max(...VALIDATORS.pack.reads)}`
				)
			],
			format
		);
	const declared = isObject(raw) ? raw.rules : undefined;
	const rules =
		isObject(declared) && typeof declared.id === 'string' && typeof declared.version === 'number'
			? findRuleset({ id: declared.id, version: declared.version })
			: undefined;
	if (!rules?.packs)
		return validationOf(
			'pack',
			[diagnostic('rules.unknown', 'rules', 'rules this server has that take homebrew')],
			format
		);
	const held = rules.packs.hold(raw);
	return validationOf(
		'pack',
		held.ok ? [] : held.problems.map((p) => fromProblem(p, packCode(p))),
		format
	);
}

/** Where a collection's report line points: the rules, then adventures, packs and tables in order. */
function itemPaths(file: CollectionFile): string[] {
	return [
		'rules',
		...file.adventures.map((_, i) => `adventures[${i}]`),
		...file.packs.map((_, i) => `packs[${i}]`),
		...file.tables.map((_, i) => `tables[${i}]`)
	];
}

/**
 * A collection: its references, then everything it names as its creator
 * (the asker) may include it, under one set of rules.
 */
export async function validateCollection(raw: unknown, ctx: ValidateContext): Promise<Validation> {
	const format = formatOf(raw, 'formatVersion');
	if (sizeOf(raw) > COLLECTION_FILE_MAX_BYTES)
		return validationOf(
			'collection',
			[diagnostic('schema.value', 'file', `at most ${COLLECTION_FILE_MAX_BYTES / 1024} KB`)],
			format
		);
	if (format !== null && format > Math.max(...VALIDATORS.collection.reads))
		return validationOf(
			'collection',
			[
				diagnostic(
					'format.newer',
					'formatVersion',
					`version ${format}; this server reads collections up to version ${Math.max(...VALIDATORS.collection.reads)}`
				)
			],
			format
		);
	const parsed = parseCollectionFile(raw);
	if (!parsed.ok)
		return validationOf(
			'collection',
			parsed.problems.map((p) =>
				fromProblem(
					p,
					p.endsWith('not a field of a collection') ? 'schema.unknown_field' : 'schema.value'
				)
			),
			format
		);
	const owner = ctx.owner ?? '';
	const file = await withRules(ctx.shelves, parsed.file, owner, ctx.collection ?? null);
	if (!file)
		return validationOf(
			'collection',
			[diagnostic('dependency.missing', 'adventures[0]', 'the first adventure could not be found')],
			format
		);
	const { items } = await resolveCollection(ctx.shelves, file, owner, ctx.collection ?? null);
	const paths = itemPaths(file);
	const CODE: Record<string, DiagnosticCode> = {
		missing: 'dependency.missing',
		unavailable: 'dependency.unavailable',
		incompatible: 'dependency.incompatible',
		invalid: 'dependency.invalid'
	};
	const diagnostics = items.flatMap((item, i) =>
		item.status === 'ok'
			? []
			: [
					diagnostic(
						item.kind === 'rules' ? 'rules.unknown' : CODE[item.status],
						paths[i],
						item.message
					)
				]
	);
	return validationOf('collection', diagnostics, format);
}

/** A character a player builds: `{ rules, choices }`, through those rules' builder. */
export function validateCharacter(raw: unknown): Validation {
	const r = isObject(raw) && isObject(raw.rules) ? raw.rules : null;
	const ruleset =
		r && typeof r.id === 'string' && typeof r.version === 'number'
			? findRuleset({ id: r.id, version: r.version })
			: undefined;
	if (!ruleset?.builder)
		return validationOf('character', [
			diagnostic('rules.unknown', 'rules', 'rules this server has that build characters')
		]);
	const preview = ruleset.builder.preview((raw as Raw).choices);
	return validationOf(
		'character',
		preview.ok ? [] : preview.problems.map((p) => fromProblem(p, 'character.invalid')),
		1
	);
}

/** The code of a refusal to read a saved story: content from another source, or damage. */
export function saveCode(error: string): DiagnosticCode {
	return /made from another source|which this server doesn't have/.test(error)
		? 'version.source'
		: 'save.invalid';
}

/** The grants a saved story says its library content was played by. */
export function savedEntitlements(data: unknown): Entitlement[] {
	const story = (data as { adventure?: { state?: { entitlements?: unknown } } } | null)?.adventure;
	const raw = story && typeof story === 'object' ? story.state?.entitlements : undefined;
	return (raw !== undefined && parseEntitlements(raw)) || [];
}

/**
 * A saved table: the scene (any version this server reads), its story read
 * as a load would read it (the lock's content, every character, homebrew,
 * collection), and every grant it rests on still in force.
 */
export async function validateSave(raw: unknown, ctx: ValidateContext): Promise<Validation> {
	const format = formatOf(raw, 'version');
	if (format !== null && format > SCENE_FILE_VERSION)
		return validationOf(
			'save',
			[
				diagnostic(
					'format.newer',
					'version',
					`version ${format}; this server reads tables up to version ${SCENE_FILE_VERSION}`
				)
			],
			format
		);
	const parsed = parseSceneFile(raw);
	if (!parsed.ok) return validationOf('save', [fromProblem(parsed.error, 'save.invalid')], format);
	const diagnostics: Diagnostic[] = [];
	if (parsed.scene.adventure) {
		// Licensed content first: what a save may not open says why, before its story is read.
		const licence = ctx.licences
			? await openRefused(
					ctx.licences,
					savedLicences(raw),
					ctx.owner ? creatorIdOf(ctx.owner) : null
				)
			: null;
		if (licence) diagnostics.push(licence);
		const story = readAdventure(parsed.scene.adventure, parsed.scene);
		if (!story.ok && licence?.code === 'licence.missing') {
			// Said already.
		} else if (!story.ok) {
			const code: DiagnosticCode = /made from another source|which this server doesn't have/.test(
				story.error
			)
				? 'version.source'
				: 'save.invalid';
			diagnostics.push(diagnostic(code, 'adventure', story.error));
		} else
			for (const note of story.notes)
				diagnostics.push(diagnostic('version.rebuilt', 'adventure.lock', note, 'warning'));
		for (const e of savedEntitlements(raw)) {
			const copy = await ctx.shelves.library.get(e.item);
			if (!stillHolds(copy, e))
				diagnostics.push(
					diagnostic(
						'access.denied',
						'adventure.entitlements',
						copy
							? `${copy.listing.title} is no longer shared with you`
							: 'something it plays is no longer in the library'
					)
				);
		}
	}
	return validationOf('save', diagnostics, format);
}
