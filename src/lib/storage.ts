// Where storage is blocked, even reaching `localStorage` throws, before any read's own try.

/** Put a storage that keeps nothing in its place, once, so every setting reads as its default. */
export function guardStorage(): void {
	try {
		if (localStorage) return;
	} catch {
		const none = { getItem: () => null, setItem() {} };
		Object.defineProperty(globalThis, 'localStorage', { value: none, configurable: true });
	}
}
