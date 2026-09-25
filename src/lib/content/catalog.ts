// Content catalogs: records of rules content (spells, monsters, gear, …)
// imported from a published source, each traceable to exactly where it came
// from. Rules-neutral: what a record's `data` holds is its ruleset's; here
// is only the envelope every catalog shares (the source, its licence and
// required credit, and each record's provenance). Plain data, never code.
// Relative imports only.

/** A published source content is imported from, pinned to one exact file. */
export interface ContentSource {
	/** e.g. "srd-5.2.1". */
	id: string;
	title: string;
	/** The source's own version, e.g. "5.2.1". */
	version: string;
	publisher: string;
	/** Where the source is published. */
	url: string;
	/** The file imported, relative to the repository. */
	file: string;
	/** SHA-256 of that file, lowercase hex. */
	sha256: string;
	license: { id: string; name: string; url: string };
	/** The credit the licence requires wherever the content is used or shared. */
	attribution: string;
}

/** Where in its source a record came from. */
export interface Provenance {
	/** The source's id. */
	source: string;
	/** The source's section headings, outermost first, e.g. ["Spells", "Spell Descriptions"]. */
	section: string[];
	/** The pages of the source the record spans, in order. */
	pages: number[];
}

/** One record of a catalog: an id stable across re-imports, its kind, name, data and text. */
export interface CatalogRecord<Kind extends string = string, Data = unknown> {
	/** `<source id>:<kind>:<slug>`, e.g. "srd-5.2.1:spell:acid-arrow". */
	id: string;
	kind: Kind;
	name: string;
	data: Data;
	/** The record's rules text as the source gives it, paragraphs separated by blank lines. */
	text: string;
	provenance: Provenance;
}

/** A slug for an id: lowercase words joined by hyphens. */
export function slugOf(name: string): string {
	return name
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/[’']/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
}

export function recordId(source: string, kind: string, name: string): string {
	return `${source}:${kind}:${slugOf(name)}`;
}
