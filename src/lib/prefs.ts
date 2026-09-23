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
