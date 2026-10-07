// Token labels on demand (#268): which names show, where they pack in the atlas, and the colours
// they are drawn in. Pure (no three.js), so the room page imports the key without the renderer and
// the server project tests it; the drawing is label-layer.ts.

/** Held (with the table focused) to show every name; agreed with #279, which moves the GM's dark tool. */
export const SHOW_NAMES_KEY = 'n';

/** What a viewer is pointing at and asking for (local UI state, never synced). */
export interface LabelState {
	hovered: string | null;
	selected: string | null;
	/** Whose turn it is in a fight. */
	active: string | null;
	/** `SHOW_NAMES_KEY` is down. */
	held: boolean;
	/** The Graphics menu's 'Always show names'. */
	always: boolean;
}

export const NO_LABELS: LabelState = {
	hovered: null,
	selected: null,
	active: null,
	held: false,
	always: false
};

/** The ids of the tokens (only those the viewer was sent) whose names show. */
export function labelsShown(tokens: readonly { id: string }[], s: LabelState): Set<string> {
	const wanted = new Set([s.hovered, s.selected, s.active]);
	return new Set(tokens.filter((t) => s.held || s.always || wanted.has(t.id)).map((t) => t.id));
}

/** A label's anchor above its mini, in cells (times the mini's scale). */
export const LABEL_HEIGHT = 1.9;
/** A name's plate: its height and widest, in CSS pixels; the text's size and the side padding. */
export const LABEL_PX = { height: 22, maxWidth: 180, font: 15, pad: 8 } as const;
/** A float's plate (damage, healing, a status), the same way. */
export const FLOAT_PX = { height: 26, maxWidth: 180, font: 18, pad: 8 } as const;
/** Every rasterised plate's gap from its neighbours in the atlas, in texels. */
export const ATLAS_GAP = 2;

/** The name's colour, on a plate at least this opaque, so nothing behind can lower the contrast. */
export const TEXT_COLOUR = '#f2e6d0';
export const PLATE = { rgb: [20, 15, 11] as const, alpha: 0.9 };
/** What floats are drawn in (RoomView's `floatResult`): each with its sign, never colour alone. */
export const FLOAT_COLOURS = {
	miss: '#b3a38a',
	damage: '#ff7b6b',
	effect: '#e0a458',
	healing: '#7fc47a',
	burning: '#ff9a4d'
} as const;

/**
 * Shelf packing into a fixed atlas: each entry goes on the first row it fits, else a new row
 * below; null when the atlas is full (the caller repacks with only what is still shown).
 */
export class Shelves {
	private rows: { y: number; height: number; x: number }[] = [];

	constructor(
		readonly width: number,
		readonly height: number
	) {}

	add(w: number, h: number): { x: number; y: number } | null {
		const [gw, gh] = [w + ATLAS_GAP, h + ATLAS_GAP];
		if (gw > this.width) return null;
		const row = this.rows.find((r) => r.height >= gh && r.x + gw <= this.width);
		if (row) return { x: (row.x += gw) - gw, y: row.y };
		const last = this.rows[this.rows.length - 1];
		const y = last ? last.y + last.height : 0;
		if (y + gh > this.height) return null;
		this.rows.push({ y, height: gh, x: gw });
		return { x: 0, y };
	}

	clear(): void {
		this.rows = [];
	}
}

/** WCAG 2 relative luminance of an sRGB colour (0-255 channels). */
function luminance(rgb: readonly number[]): number {
	const [r, g, b] = rgb.map((c) => {
		const s = c / 255;
		return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** The contrast of `hex` on the plate laid over a backdrop of `behind` (0-255 grey). */
export function contrastOnPlate(hex: string, behind: number): number {
	const plate = PLATE.rgb.map((c) => c * PLATE.alpha + behind * (1 - PLATE.alpha));
	const [a, b] = [luminance(channels(hex)), luminance(plate)];
	return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
