// Player names and room codes, apart from protocol.ts's parsers so a page
// that only asks for a name or a code (the landing page, the library) loads none of them.

export const NAME_MAX_LENGTH = 32;
export const ROOM_ID_PATTERN = /^[A-Z2-9]{6}$/;

/** Trims and strips control characters; null when the result is empty or too long. */
export function normalizeName(raw: unknown): string | null {
	if (typeof raw !== 'string') return null;
	// eslint-disable-next-line no-control-regex
	const name = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim();
	return name.length > 0 && name.length <= NAME_MAX_LENGTH ? name : null;
}
