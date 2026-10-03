// Exposure from the focus cell (#233): looking into the dark, exposure rises by up to `MAX_LIFT`
// EV so a single candle stays readable, less as light reaches the focus, never past the floor that
// keeps an unlit cell dark, and never over a cell the viewer can't see (the lift must not probe
// the dark beyond what the rules show). A pure function of what the viewer was sent and the local
// camera: no readback, the same on every tier and backend. `AtmosphereLayer` (atmosphere.ts)
// eases it over `LIFT_MS` and composes it with the sky's exposure and the flash; `worldModify`
// divides explored (remembered) cells by `2^lift`, so memory never brightens with it.

import type { Ambient } from '$lib/game/lights';
import { NIGHT_DARK } from './cell-maps';

/** The most the lift ever adds, in EV. */
export const MAX_LIFT = 1.5;
/** An unlit cell at night is never shown brighter than this (1 is a fully lit cell). */
export const DARK_CEILING = 0.5;
/** How much of the lift full light at the focus takes away. */
export const LIGHT_DAMPING = 0.6;
/** How long the lift takes to ease to a new focus, in ms (snapped under reduced motion). */
export const LIFT_MS = 800;
/** The lift's ceiling: `MAX_LIFT`, or less if more would raise an unlit night cell past the floor. */
export const LIFT_CAP = Math.min(MAX_LIFT, Math.log2(DARK_CEILING / (1 - NIGHT_DARK)));

export interface ExposureFocus {
	/** The rules' band. */
	band: Ambient;
	/** The focus cell is in a dark area. */
	focusDark: boolean;
	/** The rules' light level at the focus, 0-1. */
	focusLight: number;
	/** The viewer sees the focus cell now (always for the GM and on a table without fog). */
	focusVisible: boolean;
}

/** The exposure lift at a focus, in EV: 0 in the open by day and over anything unseen. */
export function exposureFor({ band, focusDark, focusLight, focusVisible }: ExposureFocus): number {
	if (!focusVisible || !(focusDark || band === 'dark')) return 0;
	const light = Math.min(1, Math.max(0, focusLight));
	return LIFT_CAP * (1 - LIGHT_DAMPING * light);
}
