// Licensed content (milestone 59): a publisher's catalog that thirdfold may
// use only on the terms the publisher gave. The open SRD (CC-BY-4.0) and a
// creator's homebrew stay as they were; a licensed source is a third kind,
// told apart everywhere: its ids start `lc-`, its listings say `licensed`
// and name the publisher, its licence and its attribution.
//
// A licensed source is installed on a server by its operator from a source
// file (`thirdfold-licensed-source`) beside its content, never uploaded by a
// GM and never published to the library. Its terms say who may use it (open
// to every GM, or only those the operator granted it to), whether a story
// using it may leave the server as a file, whether published adventures may
// name its content, whether its text is shown or only its mechanics, and
// what happens to stories under way when it is withdrawn. The game server
// enforces each term where it applies (docs/LICENSED.md). Plain data,
// relative imports only.

/** Where a piece of content comes from. */
export const SOURCE_KINDS = ['open', 'homebrew', 'licensed'] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export const LICENSED_FORMAT = 'thirdfold-licensed-source';
export const LICENSED_FORMAT_VERSION = 1;

/** A licensed source's id: lowercase words joined by hyphens. */
export const LICENSED_SOURCE_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+){0,5}$/;

/** Who may use a source: every GM, or only those its operator granted it to. */
export const ENTITLEMENT_POLICIES = ['open', 'granted'] as const;
export type EntitlementPolicy = (typeof ENTITLEMENT_POLICIES)[number];

/** What is shown of its records: their full text, or their mechanics only. */
export const DISPLAY_TERMS = ['full', 'mechanics'] as const;
export type DisplayTerm = (typeof DISPLAY_TERMS)[number];

/**
 * When the source is withdrawn: every story using it stops (its saves no
 * longer load), or stories under way may finish (no new story takes it up).
 */
export const WITHDRAWAL_TERMS = ['stop', 'finish'] as const;
export type WithdrawalTerm = (typeof WITHDRAWAL_TERMS)[number];

/** The terms a publisher gave for one source. */
export interface LicenceTerms {
	/** The licence by name, and where to read it. */
	licence: { name: string; url: string | null };
	entitlement: EntitlementPolicy;
	uses: {
		/** A story using it may be exported as a file (a download, to load elsewhere). */
		export: boolean;
		/** Adventures and collections published to the library may name its content. */
		reference: boolean;
	};
	display: DisplayTerm;
	withdrawal: WithdrawalTerm;
}

/** Where the source came from, for the record. */
export interface SourceProvenance {
	/** Who supplied it to this server. */
	suppliedBy: string;
	/** When (an ISO date). */
	received: string;
	/** The agreement it was supplied under, by name or reference. */
	agreement: string;
	/** A made-up publisher and catalog, to show and test the interfaces. */
	hypothetical: boolean;
}

/** A licensed source as its source file describes it. */
export interface LicensedSourceFile {
	format: typeof LICENSED_FORMAT;
	formatVersion: typeof LICENSED_FORMAT_VERSION;
	id: string;
	name: string;
	publisher: string;
	/** The publisher's version of it ("1.0"). */
	version: string;
	about: string;
	/** The rules it is for, at their exact version. */
	rules: { id: string; version: number };
	/** The credit to show wherever it is used, as the publisher wrote it. */
	attribution: string;
	/** The publisher's marks: shown only in the attribution, never in its content. */
	trademarks: string[];
	terms: LicenceTerms;
	provenance: SourceProvenance;
	/** Its content file, beside it, pinned by its SHA-256. */
	content: { file: string; sha256: string };
}

/** Whether a source may be used now, as its operator set it. */
export const SOURCE_STATUSES = ['active', 'withdrawn'] as const;
export type SourceStatus = (typeof SOURCE_STATUSES)[number];

/** A licensed source as a GM sees it: what it is, its terms, and whether they may use it. */
export interface LicensedSourceView {
	id: string;
	name: string;
	publisher: string;
	version: string;
	about: string;
	attribution: string;
	terms: LicenceTerms;
	hypothetical: boolean;
	/** Records it holds, by kind. */
	counts: Record<string, number>;
	/** The asking GM may attach it to a story. */
	usable: boolean;
}

/** A story's hold on a licensed source: which, at which version, and the grant it rests on. */
export interface LicenceUse {
	source: string;
	version: string;
	/** The content's SHA-256, as installed when the story took it up. */
	sha256: string;
	/** The operator's grant it rests on, or null for an open source. */
	grant: string | null;
}

/** The terms in words, for a listing. */
export function describeTerms(terms: LicenceTerms): string[] {
	return [
		terms.entitlement === 'open' ? 'Open to every GM on this server' : 'Only for GMs granted it',
		terms.display === 'full' ? 'Text shown' : 'Mechanics only: its text is not shown',
		terms.uses.export ? 'Stories may be exported' : 'Stories using it stay on this server',
		terms.uses.reference
			? 'Published adventures may name its content'
			: 'Published adventures may not name its content',
		terms.withdrawal === 'stop'
			? 'If withdrawn, stories using it stop'
			: 'If withdrawn, stories under way may finish'
	];
}
