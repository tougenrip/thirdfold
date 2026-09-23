import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
	appId: 'com.example.thirdfold',
	appName: 'thirdfold',
	webDir: 'build',
	// Local Supabase is plain http. An https app origin would block it as mixed
	// content on Android, so match the scheme until the API has TLS.
	server: {
		androidScheme: 'http',
		cleartext: true
	}
};

export default config;
