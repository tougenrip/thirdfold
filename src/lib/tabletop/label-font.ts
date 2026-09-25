// The font that token labels and die faces are drawn in: the app's Alegreya,
// bundled, so a canvas label looks the same on every system (and in golden
// images) instead of whatever system-ui happens to be. Where there is no
// FontFace (Node tests) nothing loads and labels fall back to sans-serif.

import w600 from '@fontsource/alegreya/files/alegreya-latin-600-normal.woff2?url';
import w700 from '@fontsource/alegreya/files/alegreya-latin-700-normal.woff2?url';
import w800 from '@fontsource/alegreya/files/alegreya-latin-800-normal.woff2?url';

const FACES: [number, string][] = [
	[600, w600],
	[700, w700],
	[800, w800]
];

/** Resolves once the label weights are loaded (or can't be); labels drawn before then are redrawn. */
export const labelFontReady: Promise<void> =
	typeof FontFace === 'undefined' || typeof document === 'undefined'
		? Promise.resolve()
		: Promise.all(
				FACES.map(([weight, url]) =>
					new FontFace('Alegreya', `url(${url})`, { weight: String(weight) })
						.load()
						.then((face) => void document.fonts.add(face))
				)
			).then(
				() => {},
				() => {}
			);

/** A canvas font string for labels. */
export function labelFont(weight: 600 | 700 | 800, px: number): string {
	return `${weight} ${px}px Alegreya, sans-serif`;
}
