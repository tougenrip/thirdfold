// Size caps and names for files people bring in (scenes, adventure files),
// apart from their parsers so a page that only checks a size never loads them.

export const SCENE_NAME_MAX_LENGTH = 48;
/** Serialized size cap (a table, and the adventure file a save may carry), before parsing and saving. */
export const SCENE_FILE_MAX_BYTES = 3 * 1024 * 1024;
/** A content pack's (homebrew's) serialized size cap, checked before parsing. */
export const CONTENT_PACK_MAX_BYTES = 128 * 1024;
/** A collection's serialized size cap (it only names what it holds), checked before parsing. */
export const COLLECTION_FILE_MAX_BYTES = 16 * 1024;
/** An adventure file's serialized size cap, checked before parsing. */
export const ADVENTURE_FILE_MAX_BYTES = 1024 * 1024;

export function normalizeSceneName(raw: unknown): string | null {
	if (typeof raw !== 'string') return null;
	// eslint-disable-next-line no-control-regex
	const name = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim();
	return name.length > 0 && name.length <= SCENE_NAME_MAX_LENGTH ? name : null;
}
