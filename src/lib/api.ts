import { Capacitor } from '@capacitor/core';

const base = import.meta.env.VITE_SUPABASE_URL ?? 'http://localhost:54321';

// The Android emulator reaches the host at 10.0.2.2; `localhost` there is the
// emulator itself. Emulator-only: a physical device needs the LAN IP in .env.
export const API_URL =
	Capacitor.getPlatform() === 'android' && base.includes('localhost')
		? base.replace('localhost', '10.0.2.2')
		: base;
