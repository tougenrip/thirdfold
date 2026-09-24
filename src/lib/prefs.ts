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
