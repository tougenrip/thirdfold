// Draws the dice's numeral atlas (#275) into assets/textures/dice-numerals.png: 8 × 8 cells of
// 64 px, white glyph coverage on black (the material reads red), in the bundled Alegreya (OFL,
// listed on /credits) as the old face decals were. The layout is dice-geometry.ts's: `cellText`
// for the numerals, the d6's pips, and `d4Cells` for each d4 face's corner numbers, so the atlas
// and the dice's UVs can't disagree. Run by hand after changing the layout, then `npm run assets`:
//   npx tsx scripts/make-dice-atlas.ts
// The PNG is written by png.ts, so the bytes depend only on the pixels Chromium draws.

import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { encodePng } from '../server/assets/png';
import { ATLAS_GRID, cellText, d4Cells, GLYPH_RADIUS } from '../src/lib/tabletop/dice-geometry';

const SIZE = 512;
const CELL = SIZE / ATLAS_GRID;
const font = readFileSync(
	'node_modules/@fontsource/alegreya/files/alegreya-latin-800-normal.woff2'
);

/** What a cell holds: a numeral, a d6 face's pips or a d4 face's corner numbers. */
type Mark =
	| { kind: 'text'; text: string }
	| { kind: 'pips'; count: number }
	| { kind: 'corners'; marks: { label: string; at: [number, number] }[] };

const cells: Mark[] = [
	...Array.from({ length: 31 }, (_, i): Mark => ({ kind: 'text', text: cellText(i) })),
	...Array.from({ length: 6 }, (_, i): Mark => ({ kind: 'pips', count: i + 1 })),
	...d4Cells().map((marks): Mark => ({ kind: 'corners', marks }))
];

const browser = await chromium.launch();
const page = await browser.newPage();
await page.evaluate('globalThis.__name = (f) => f'); // tsx names the functions it passes over
const rgba = await page.evaluate(
	async ({ cells, font, size, cell, glyph }) => {
		const face = new FontFace('Atlas', `url(data:font/woff2;base64,${font})`);
		document.fonts.add(await face.load());
		const canvas = document.createElement('canvas');
		canvas.width = canvas.height = size;
		const ctx = canvas.getContext('2d')!;
		ctx.fillStyle = '#000';
		ctx.fillRect(0, 0, size, size);
		ctx.fillStyle = '#fff';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'alphabetic';
		/** Text centred on (x, y) by its ink, `px` tall at most and `width` wide at most. */
		const text = (t: string, x: number, y: number, px: number, width: number) => {
			ctx.font = `800 ${px}px Atlas`;
			const m = ctx.measureText(t);
			const scale = Math.min(1, width / (m.actualBoundingBoxLeft + m.actualBoundingBoxRight));
			ctx.save();
			ctx.translate(x, y);
			ctx.scale(scale, scale);
			const dx = (m.actualBoundingBoxLeft - m.actualBoundingBoxRight) / 2;
			const dy = (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
			ctx.fillText(t, dx, dy);
			ctx.restore();
		};
		const PIPS: Record<number, [number, number][]> = {
			1: [[0, 0]],
			2: [
				[-1, -1],
				[1, 1]
			],
			3: [
				[-1, -1],
				[0, 0],
				[1, 1]
			],
			4: [
				[-1, -1],
				[1, -1],
				[-1, 1],
				[1, 1]
			],
			5: [
				[-1, -1],
				[1, -1],
				[0, 0],
				[-1, 1],
				[1, 1]
			],
			6: [
				[-1, -1],
				[1, -1],
				[-1, 0],
				[1, 0],
				[-1, 1],
				[1, 1]
			]
		};
		cells.forEach((mark, i) => {
			const cx = (i % 8) * cell + cell / 2;
			const cy = Math.floor(i / 8) * cell + cell / 2;
			if (mark.kind === 'text') {
				// Within the glyph circle: one digit taller, two or three narrower.
				const r = glyph * cell;
				const long = mark.text.replace('.', '').length > 1;
				text(mark.text, cx, cy, long ? r * 1.25 : r * 1.5, r * 1.75);
			} else if (mark.kind === 'pips') {
				// The face fills the cell (dice-geometry.ts, CELL_FILL): pips on a 3 × 3 grid within it.
				for (const [x, y] of PIPS[mark.count]) {
					ctx.beginPath();
					ctx.arc(
						cx + x * cell * 0.22,
						cy + y * cell * 0.22,
						cell * (mark.count === 1 ? 0.12 : 0.085),
						0,
						Math.PI * 2
					);
					ctx.fill();
				}
			} else {
				// Each corner's number halfway out to it, its top towards the corner.
				for (const { label, at } of mark.marks) {
					ctx.save();
					ctx.translate(cx + at[0] * cell * 0.5, cy - at[1] * cell * 0.5);
					ctx.rotate(Math.atan2(at[0], at[1]));
					text(label, 0, 0, cell * 0.24, cell);
					ctx.restore();
				}
			}
		});
		return Array.from(ctx.getImageData(0, 0, size, size).data);
	},
	{ cells, font: font.toString('base64'), size: SIZE, cell: CELL, glyph: GLYPH_RADIUS }
);
await browser.close();

// Coverage in every colour channel (the material reads red), opaque.
const pixels = new Uint8Array(rgba);
for (let i = 0; i < pixels.length; i += 4) {
	pixels[i + 1] = pixels[i + 2] = pixels[i];
	pixels[i + 3] = 255;
}
writeFileSync('assets/textures/dice-numerals.png', encodePng(SIZE, SIZE, pixels));
console.log('wrote assets/textures/dice-numerals.png');
