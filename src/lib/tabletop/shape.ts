// What a tabletop is built with before and after its device is known (#150, #180): MSAA, the
// prepass, the antialiasing and the AO fix a renderer's pipeline, so the table component and the
// lobby's warm-up (lobby.ts) read them the same way, and a renderer warmed in the lobby is one the
// table can adopt.

import {
	aoKind,
	layersFrom,
	loadGraphics,
	needsPrepass,
	settingsFor,
	startingTier,
	tierFrom,
	toneMapperFrom,
	withOverrides,
	type AaMode,
	type AoKind,
	type Caps,
	type QualitySettings
} from './quality';

export interface Shape {
	antialias: boolean;
	prepass: boolean;
	aa: AaMode;
	ao: AoKind;
}

/** The shape of the next tabletop, from the settings where they are known before the device is. */
export function initialShape(): Shape {
	if (typeof location === 'undefined')
		return { antialias: true, prepass: true, aa: 'msaa', ao: 'ssao' };
	const prefs = loadGraphics(localStorage);
	const known = tierFrom(location.search) ?? (prefs.tier !== 'auto' ? prefs.tier : prefs.measured);
	const s = withOverrides(settingsFor(known ?? 'medium', 'webgpu'), prefs.overrides, 'webgpu');
	return shapeOf(s);
}

/** The pipeline shape `settings` build. */
export function shapeOf(s: QualitySettings): Shape {
	return { antialias: s.msaa > 0, prepass: needsPrepass(s), aa: s.aa, ao: aoKind(s) };
}

/** Whether two shapes build the same pipeline (a renderer of one draws the other). */
export const sameShape = (a: Shape, b: Shape): boolean =>
	a.antialias === b.antialias && a.prepass === b.prepass && a.aa === b.aa && a.ao === b.ao;

/** The settings a table starts on for `caps`, as the table component applies them. */
export function startingSettings(caps: Caps): QualitySettings {
	const search = location.search;
	const prefs = loadGraphics(localStorage);
	const settings = withOverrides(
		settingsFor(startingTier(search, prefs, caps), caps.backend),
		prefs.overrides,
		caps.backend
	);
	const toneMapper = toneMapperFrom(search) ?? prefs.toneMapper;
	return { ...settings, layers: layersFrom(search, settings.layers), toneMapper };
}
