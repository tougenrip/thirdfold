// What the library tells a GM about an adventure before they run it: what its
// file holds, counted, and how it greets the party. Nothing that would spoil
// the story (no chapter names, clues or endings' names).

import type { AdventureDef } from './define';
import type { BuiltInStory, StoryFacts } from '../../src/lib/game/library';

export function storyFacts(a: AdventureDef): StoryFacts {
	return {
		chapters: Object.keys(a.chapters).length,
		places: Object.keys(a.locations).length,
		characters: Object.keys(a.characters).length,
		endings: Object.keys(a.endings.names).length
	};
}

/** How the story greets the party where it starts (the arrival's welcome). */
export function openingOf(a: AdventureDef): string {
	return a.locations[a.start.location]?.welcome ?? '';
}

export function builtInStory(a: AdventureDef): BuiltInStory {
	return {
		id: a.id,
		title: a.title,
		about: a.about ?? '',
		opening: openingOf(a),
		facts: storyFacts(a)
	};
}
