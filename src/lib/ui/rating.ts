// How the library shows a rating and a count, in words and stars.

import type { Rating, StoryFacts } from '$lib/game/library';

/** "★ 4.5 · 12 ratings", or "Not rated yet". */
export function describeRating(rating: Rating | null): string {
	if (!rating) return 'Not rated yet';
	return `★ ${rating.average.toFixed(1)} · ${rating.count} ${rating.count === 1 ? 'rating' : 'ratings'}`;
}

/** "Played 3 times", "Not played yet". */
export function describePlays(plays: number): string {
	if (plays === 0) return 'Not played yet';
	return plays === 1 ? 'Played once' : `Played ${plays} times`;
}

/** "1 chapter", "3 chapters". */
export function plural(n: number, one: string): string {
	return `${n} ${n === 1 ? one : `${one}s`}`;
}

/** "5 chapters · 3 places · up to 4 players · 3 endings". */
export function describeFacts(f: StoryFacts): string {
	return [
		plural(f.chapters, 'chapter'),
		plural(f.places, 'place'),
		`up to ${plural(f.characters, 'player')}`,
		plural(f.endings, 'ending')
	].join(' · ');
}
