// Motions: how a change on the table is shown, beyond the change itself. A
// prop that moves or turns already glides there on every client; a motion
// adds what the state can't say, like a lever swinging, a chain rattling or
// a dropped thing landing, and the sound it makes. The server sends them
// with the change they belong to, to the viewers who can see that prop
// (those who can't only hear it). Presentation only: nothing reads them for
// the rules, and a client that misses one misses nothing but the show.

/** What a prop does: shakes (rattles), swings on its pivot, or lands from above. */
export type MotionKind = 'shake' | 'swing' | 'land';

export const MOTION_KINDS: readonly MotionKind[] = ['shake', 'swing', 'land'];

export type Sound = 'clank' | 'rattle' | 'grind' | 'chime' | 'crack' | 'scrape' | 'thud';

export const SOUNDS: readonly Sound[] = [
	'clank',
	'rattle',
	'grind',
	'chime',
	'crack',
	'scrape',
	'thud'
];

export interface Motion {
	/** The prop that moves; null for a sound alone (the prop is out of this viewer's sight). */
	propId: string | null;
	kind: MotionKind | null;
	sound: Sound | null;
}

/** How long each motion plays, in ms. */
export const MOTION_MS: Record<MotionKind, number> = { shake: 700, swing: 900, land: 450 };

/** What a viewer who can't see `motion`'s prop gets of it: the sound, or nothing. */
export function heardOnly(motion: Motion): Motion | null {
	return motion.sound ? { propId: null, kind: null, sound: motion.sound } : null;
}
