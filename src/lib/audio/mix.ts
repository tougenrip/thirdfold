// How loud each part of thirdfold's sound is, as the player set it. Kept in
// this browser only (localStorage), like the camera view: it is nobody
// else's business.

export interface Mix {
	muted: boolean;
	/** 0..1 each. */
	master: number;
	music: number;
	ambience: number;
	effects: number;
}

export const DEFAULT_MIX: Mix = {
	muted: false,
	master: 0.8,
	music: 0.6,
	ambience: 0.7,
	effects: 0.9
};

const KEY = 'thirdfold:audio';
const LEVELS = ['master', 'music', 'ambience', 'effects'] as const;

const clamp = (v: unknown, fallback: number) =>
	typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback;

/** The saved mix, or the default; anything unreadable falls back field by field. */
export function loadMix(storage: Pick<Storage, 'getItem'>): Mix {
	try {
		const raw = JSON.parse(storage.getItem(KEY) ?? 'null') as unknown;
		if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_MIX };
		const r = raw as Record<string, unknown>;
		const mix: Mix = { ...DEFAULT_MIX, muted: r.muted === true };
		for (const k of LEVELS) mix[k] = clamp(r[k], DEFAULT_MIX[k]);
		return mix;
	} catch {
		return { ...DEFAULT_MIX };
	}
}

export function saveMix(storage: Pick<Storage, 'setItem'>, mix: Mix): void {
	try {
		storage.setItem(KEY, JSON.stringify(mix));
	} catch {
		// Private windows and full storage: the mix just isn't remembered.
	}
}

/** A bus's gain: its level times the master's, or silence when muted. */
export function busGain(mix: Mix, bus: 'music' | 'ambience' | 'effects'): number {
	return mix.muted ? 0 : mix.master * mix[bus];
}
