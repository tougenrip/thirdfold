// What is wrong with a piece of content, said the same way everywhere
// (milestone 56): an adventure file, a homebrew pack, a collection, a
// character a player builds, a saved table. Each finding is a diagnostic
// with a stable code (what kind of problem; it never changes meaning), a
// path (where in the content), a message (what exactly) and a hint (how to
// fix it). The builder shows them as a creator works; the server repeats the
// same checks on import, publish, load and session start, and refuses with
// the same diagnostics. Plain data, relative imports only.

/** What can be checked. */
export const CONTENT_KINDS = ['adventure', 'pack', 'collection', 'character', 'save'] as const;
export type ContentKind = (typeof CONTENT_KINDS)[number];

/** Every diagnostic code, and how to fix what it names. Codes are never renamed or reused. */
export const DIAGNOSTICS = {
	'format.unknown': 'This is not that kind of thirdfold file. Check you opened the right file.',
	'format.newer':
		'It was made by a newer thirdfold than this server reads. Open it on an updated server.',
	'schema.value': 'Change the value to one of the kind it asks for.',
	'schema.unknown_field':
		'Remove the field, or check its spelling: thirdfold never ignores a field it doesn’t know.',
	'ref.missing': 'Add the thing it names, or change the name to one that exists.',
	'ref.reserved': 'Pick another id: this one is thirdfold’s own.',
	'dice.invalid': 'Write dice as NdX or NdX+M, with X one of 4, 6, 8, 10, 12, 20 or 100.',
	'story.structure': 'Fix the story’s shape where it says: something it needs is missing.',
	'map.placement': 'Move it onto its table, or move the table’s cells.',
	'rules.unknown': 'Pick rules this server has.',
	'rules.mismatch': 'Everything in it must play by the same rules.',
	'rules.check': 'Change it to something these rules can play.',
	'content.markup': 'Remove the markup or code: content is plain text and data.',
	'content.srd_name': 'Give it a name of its own: the SRD’s names are the SRD’s.',
	'dependency.missing': 'Publish what it names, or fix the reference.',
	'dependency.unavailable': 'Ask its creator to share it with you or with this collection.',
	'dependency.incompatible': 'Use a piece that plays by the same rules.',
	'dependency.invalid': 'Ask its creator to publish a version that reads again.',
	'access.denied': 'Ask its creator to share it with you.',
	'version.source':
		'It was made with different content from the rules’ source: open it on a server with the same source.',
	'version.rebuilt': 'Nothing to do: the content was rebuilt and everything was checked again.',
	'character.invalid': 'Change the choice it names: the rules don’t allow it.',
	'save.invalid': 'The saved table is damaged where it says; an earlier save may still open.',
	'licence.missing':
		'Open it on a server that has that licensed source installed, at the same version.',
	'licence.withdrawn': 'Its publisher withdrew the source: it can no longer be used here.',
	'licence.denied': 'Ask the server’s operator to grant you the licensed source.',
	'licence.terms':
		'The source’s licence doesn’t allow this: keep the story on this server, or leave its content out.'
} as const;
export type DiagnosticCode = keyof typeof DIAGNOSTICS;
export const DIAGNOSTIC_CODES = Object.keys(DIAGNOSTICS) as DiagnosticCode[];

export interface Diagnostic {
	code: DiagnosticCode;
	/** An error stops the content; a warning is told and lets it through. */
	severity: 'error' | 'warning';
	/** Where: a field path (`chapters.the_mill.next.to`) or a named place (`chapter the_mill`). */
	path: string;
	message: string;
}

/** Which checks were run, at which version, and the format version of what they read. */
export interface Validator {
	id: string;
	version: number;
	/** The content's own format version, when it carries one. */
	format: number | null;
}

/** A whole check of one piece of content. */
export interface Validation {
	kind: ContentKind;
	validator: Validator;
	/** No errors (warnings may remain). */
	ok: boolean;
	diagnostics: Diagnostic[];
}

/**
 * The validators, by content kind: their version (bumped when the checks
 * change) and the format versions they read. Older formats stay readable by
 * the validator that reads them; a newer one is refused with `format.newer`.
 */
export const VALIDATORS: Record<ContentKind, { id: string; version: number; reads: number[] }> = {
	adventure: { id: 'thirdfold-adventure', version: 1, reads: [1] },
	pack: { id: 'thirdfold-homebrew', version: 1, reads: [1] },
	collection: { id: 'thirdfold-collection', version: 1, reads: [1] },
	character: { id: 'thirdfold-character', version: 1, reads: [1] },
	// Version 2 (milestone 59) also checks the licensed sources a saved story uses.
	save: { id: 'thirdfold-scene', version: 2, reads: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] }
};

/** At most this many diagnostics are reported for one piece of content. */
export const DIAGNOSTICS_MAX = 200;

/** A diagnostic from a "path: message" problem, as the readers have always written them. */
export function fromProblem(
	problem: string,
	code: DiagnosticCode,
	severity: Diagnostic['severity'] = 'error'
): Diagnostic {
	const at = problem.indexOf(': ');
	return at > 0
		? { code, severity, path: problem.slice(0, at), message: problem.slice(at + 2) }
		: { code, severity, path: '', message: problem };
}

export function diagnostic(
	code: DiagnosticCode,
	path: string,
	message: string,
	severity: Diagnostic['severity'] = 'error'
): Diagnostic {
	return { code, severity, path, message };
}

/** A check's result. */
export function validationOf(
	kind: ContentKind,
	diagnostics: readonly Diagnostic[],
	format: number | null = null
): Validation {
	const v = VALIDATORS[kind];
	const kept = diagnostics.slice(0, DIAGNOSTICS_MAX);
	return {
		kind,
		validator: { id: v.id, version: v.version, format },
		ok: !kept.some((d) => d.severity === 'error'),
		diagnostics: kept.map((d) => ({ ...d }))
	};
}

/** The first error, said in one line, for a refusal: "chapters.x: no event "y"". */
export function firstError(diagnostics: readonly Diagnostic[]): string | null {
	const d = diagnostics.find((x) => x.severity === 'error');
	return d ? (d.path ? `${d.path}: ${d.message}` : d.message) : null;
}

/** How to fix what a code names. */
export function hintOf(code: DiagnosticCode): string {
	return DIAGNOSTICS[code];
}

/** Whether a value read off the wire is a diagnostic (the browser checks what it is sent). */
export function isDiagnostic(v: unknown): v is Diagnostic {
	if (typeof v !== 'object' || v === null) return false;
	const d = v as Record<string, unknown>;
	return (
		typeof d.code === 'string' &&
		Object.hasOwn(DIAGNOSTICS, d.code) &&
		(d.severity === 'error' || d.severity === 'warning') &&
		typeof d.path === 'string' &&
		typeof d.message === 'string'
	);
}
