// The session's end screen, worked out from the view: how the party came
// through, how long the story took, and who asked to play again. Pure, so it
// is tested in Node; SectionEnd.svelte shows it.

import type { CharacterStatus } from '../adventure/adventure';

/** One line on how the party fared: survived, some of it, or none. */
export function survivalLine(characters: readonly CharacterStatus[], won: boolean): string {
	const party = characters.filter((c) => c.inPlay);
	const alive = party.filter((c) => !c.dead).length;
	if (!won) return alive === 0 ? 'None of the party survived.' : 'The party fell.';
	if (party.length === 0) return 'The story is told.';
	if (alive === party.length) return 'The party survived.';
	if (alive === 0) return 'None of the party survived.';
	const word = (n: number) => NUMBERS[n] ?? String(n);
	const some = word(alive);
	return `${some[0].toUpperCase()}${some.slice(1)} of the ${word(party.length)} survived.`;
}

const NUMBERS = ['none', 'one', 'two', 'three', 'four', 'five', 'six'];

/** How long the story took, hh:mm:ss; null if it never began or hasn't ended. */
export function timePlayed(begunAt: number | null, completedAt: number | null): string | null {
	if (begunAt === null || completedAt === null) return null;
	const s = Math.max(0, Math.round((completedAt - begunAt) / 1000));
	const two = (n: number) => String(n).padStart(2, '0');
	return `${two(Math.floor(s / 3600))}:${two(Math.floor((s % 3600) / 60))}:${two(s % 60)}`;
}

/** "Mira", "Mira and Tom", "Mira, Tom and Ada". */
export function namesList(names: readonly string[]): string {
	if (names.length <= 1) return names[0] ?? '';
	return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
