// Per-browser conveniences. Storage may be unavailable (private mode), so
// every access degrades to "no saved value".

const NAME_KEY = 'thirdfold:name';

export function loadName(): string {
	try {
		return localStorage.getItem(NAME_KEY) ?? '';
	} catch {
		return '';
	}
}

export function saveName(name: string): void {
	try {
		localStorage.setItem(NAME_KEY, name);
	} catch {
		// ignore
	}
}

export interface SavedSceneRef {
	sceneId: string;
	name: string;
	savedAt: string;
}

const SCENES_KEY = 'thirdfold:scenes';
const MAX_REMEMBERED_SCENES = 50;

/** Scenes this browser saved. The id is the only key to a saved scene, so it is kept here. */
export function loadSavedScenes(): SavedSceneRef[] {
	try {
		const list = JSON.parse(localStorage.getItem(SCENES_KEY) ?? '[]');
		return Array.isArray(list)
			? list.filter(
					(s): s is SavedSceneRef =>
						typeof s?.sceneId === 'string' &&
						/^[0-9a-f]{32}$/.test(s.sceneId) &&
						typeof s.name === 'string' &&
						typeof s.savedAt === 'string'
				)
			: [];
	} catch {
		return [];
	}
}

export function storeSavedScenes(list: SavedSceneRef[]): void {
	try {
		localStorage.setItem(SCENES_KEY, JSON.stringify(list.slice(0, MAX_REMEMBERED_SCENES)));
	} catch {
		// ignore: the scene is still saved on the server, just not remembered here
	}
}

const GM_KEY = 'thirdfold:gm-key';
const GM_KEY_PATTERN = /^[0-9a-f]{64}$/;

/**
 * This browser's GM key: what makes a GM's saves theirs (see server/gm-keys.ts).
 * Issued by the server the first time this browser opens a table; the GM can
 * copy it to another device. Secret, like a password.
 */
export function loadGmKey(): string | null {
	try {
		const key = localStorage.getItem(GM_KEY);
		return key && GM_KEY_PATTERN.test(key) ? key : null;
	} catch {
		return null;
	}
}

export function saveGmKey(key: string): boolean {
	if (!GM_KEY_PATTERN.test(key)) return false;
	try {
		localStorage.setItem(GM_KEY, key);
		return true;
	} catch {
		return false;
	}
}

const CREATOR_KEY = 'thirdfold:creator';

/** The name this browser last published adventures under. */
export function loadCreatorName(): string {
	try {
		return localStorage.getItem(CREATOR_KEY) ?? '';
	} catch {
		return '';
	}
}

export function saveCreatorName(name: string): void {
	try {
		localStorage.setItem(CREATOR_KEY, name);
	} catch {
		// ignore
	}
}
