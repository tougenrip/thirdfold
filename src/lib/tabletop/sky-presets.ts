// The default open sky, in code until the asset pipeline builds skies from `assets/skies` (#213).
// Tuned so the canonical hours (12:00, 19:30, 23:00) give exactly the old lighting presets'
// hemisphere, sun and haze (lighting.ts `PRESETS` before #218): the horizon and fog take the old
// background colour. The keys mirror time-blend.ts's (#208): dark 22:00-04:30, dawn at 06:00, day
// 08:00-17:30, dusk at 19:30. What the old presets had no word for (the zenith, IBL, the moon,
// stars, clouds, night glow) is a first guess for the M67 look review (D7).

import type { SkyKey, SkyPreset } from './atmosphere-curve';

type Look = Omit<SkyKey, 'minute'>;

const DAY: Look = {
	sunColor: '#ffe2b8',
	sun: 1.6,
	moon: 0,
	hemiSky: '#fff1dc',
	hemiGround: '#1c140e',
	hemi: 0.9,
	ibl: 0.3,
	zenith: '#3a4a5c',
	horizon: '#292421',
	ground: '#1c140e',
	fog: { color: '#292421', density: 0.002, height: 3 },
	exposure: 0,
	stars: 0,
	clouds: 0.15,
	nightGlow: 0
};

const DUSK: Look = {
	sunColor: '#ffe2b8',
	sun: 0.55,
	moon: 0.1,
	hemiSky: '#ffd0a0',
	hemiGround: '#1a2438',
	hemi: 0.45,
	ibl: 0.15,
	zenith: '#1c2038',
	horizon: '#221f28',
	ground: '#1a2438',
	fog: { color: '#221f28', density: 0.0025, height: 3 },
	exposure: 0,
	stars: 0,
	clouds: 0.15,
	nightGlow: 0.6
};

const DARK: Look = {
	sunKelvin: 2000,
	sun: 0,
	moon: 0.15,
	hemiSky: '#9ab4ff',
	hemiGround: '#0a1230',
	hemi: 0.1,
	ibl: 0.05,
	zenith: '#070a16',
	horizon: '#121828',
	ground: '#0a1230',
	fog: { color: '#121828', density: 0.003, height: 3 },
	exposure: 0,
	stars: 1,
	clouds: 0.15,
	nightGlow: 1
};

/** The sun at 06:00 is still a little below the horizon: warm, low (Kelvin wins over the colour). */
const DAWN: Look = { ...DUSK, sunKelvin: 2600 };

export const temperate: SkyPreset = {
	kind: 'open',
	path: { latitude: 45, declination: 10, north: 0, noon: 780 },
	moonCycle: 29.5,
	moonPhase: 14.75,
	moonColor: '#9ab4ff',
	keys: [
		{ minute: 270, ...DARK },
		{ minute: 360, ...DAWN },
		{ minute: 480, ...DAY },
		{ minute: 720, ...DAY },
		{ minute: 1050, ...DAY },
		{ minute: 1170, ...DUSK },
		{ minute: 1320, ...DARK },
		{ minute: 1380, ...DARK }
	]
};
