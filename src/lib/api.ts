import { Capacitor } from '@capacitor/core';

// The Android emulator reaches the host at 10.0.2.2; `localhost` there is the
// emulator itself. Emulator-only: a physical device needs the LAN IP in .env.
function forPlatform(url: string): string {
	return Capacitor.getPlatform() === 'android' && url.includes('localhost')
		? url.replace('localhost', '10.0.2.2')
		: url;
}

export const API_URL = forPlatform(import.meta.env.VITE_SUPABASE_URL ?? 'http://localhost:54321');

// Defaults to port 8787 on whatever host served the page, so a LAN browser
// reaches the dev machine's game server without extra config. Native shells
// serve the app from their own origin, so they fall back to localhost.
function defaultGameServerHost(): string {
	if (typeof window === 'undefined' || Capacitor.isNativePlatform()) return 'localhost';
	if ('__TAURI_INTERNALS__' in window) return 'localhost';
	return window.location.hostname || 'localhost';
}

export const GAME_SERVER_URL = forPlatform(
	import.meta.env.VITE_GAME_SERVER_URL || `ws://${defaultGameServerHost()}:8787`
);
