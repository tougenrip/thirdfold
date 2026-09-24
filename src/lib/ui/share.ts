// Shared tables travel as a link, `<origin>/?table=<code>`, where the code
// is the shared copy's id (see `scene_share`). Opening one on the landing
// page opens a new table on it; at a table, the Scene panel opens it there.

const CODE = /^[0-9a-f]{32}$/;

/** The link that opens a shared table. */
export function sharedLink(origin: string, code: string): string {
	return `${origin}/?table=${code}`;
}

/** The code in a pasted link or code, or null if there is none. */
export function sharedCode(input: string): string | null {
	const text = input.trim();
	if (CODE.test(text)) return text;
	try {
		const code = new URL(text).searchParams.get('table');
		return code && CODE.test(code) ? code : null;
	} catch {
		return null;
	}
}
