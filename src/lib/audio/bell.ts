// The Hollow Bell's voice. A cast bell doesn't ring a single note: it rings
// a cluster of partials at inharmonic ratios (the hum an octave below, the
// prime, a minor-third "tierce" that gives bells their sad colour, the quint,
// the nominal an octave up, and a few higher ones), each dying away at its
// own rate, the low ones last. Every bell in thirdfold (the great bell's
// toll, the hand bell, the music's motif, the UI's chimes) is built from this
// table, so they sound like one family. Pure numbers; engine.ts plays them.

export interface Partial {
	/** Frequency as a multiple of the strike note. */
	ratio: number;
	/** Loudness, 0..1. */
	gain: number;
	/** How long it rings, as a fraction of the bell's whole ring. */
	decay: number;
}

export const BELL_PARTIALS: readonly Partial[] = [
	{ ratio: 0.5, gain: 0.55, decay: 1 }, // hum
	{ ratio: 1, gain: 0.8, decay: 0.8 }, // prime (the strike note)
	{ ratio: 1.183, gain: 0.5, decay: 0.7 }, // tierce: a minor third, the bell's sadness
	{ ratio: 1.506, gain: 0.35, decay: 0.55 }, // quint
	{ ratio: 2, gain: 0.6, decay: 0.5 }, // nominal
	{ ratio: 2.514, gain: 0.25, decay: 0.35 },
	{ ratio: 2.662, gain: 0.2, decay: 0.3 },
	{ ratio: 3.011, gain: 0.18, decay: 0.25 },
	{ ratio: 4.166, gain: 0.1, decay: 0.15 }
];

export type BellSize = 'great' | 'flash' | 'hand' | 'chime' | 'motif';

/** Strike note (Hz), ring length (s) and loudness for each bell in the family. */
export const BELLS: Record<BellSize, { note: number; ring: number; gain: number }> = {
	/** The Hollow Bell itself and the monastery's tower bell: deep, long. */
	great: { note: 98, ring: 9, gain: 1 },
	/** Its light flashing across the Hollow: the same bell, heard from inside the flash. */
	flash: { note: 196, ring: 6, gain: 0.7 },
	/** The gatehouse hand bell. */
	hand: { note: 784, ring: 2.2, gain: 0.5 },
	/** Small UI chimes. */
	chime: { note: 1175, ring: 1.2, gain: 0.25 },
	/** A note of the music's bell motif; its pitch is set per note. */
	motif: { note: 392, ring: 4, gain: 0.35 }
};

/** The partials of a bell struck at `note` Hz, ringing `ring` seconds: frequency, gain, length. */
export function bellPartials(
	note: number,
	ring: number
): { freq: number; gain: number; length: number }[] {
	return BELL_PARTIALS.map((p) => ({
		freq: note * p.ratio,
		gain: p.gain,
		length: Math.max(0.15, ring * p.decay)
	}));
}
