// What an adventure file comes to under its rules (milestone 57), as the
// server works it out for the builder: the rules and the content they read,
// the party its rules build, and the monsters it takes from their bestiary.
// The builder shows it beside the server's diagnostics; nothing here is
// computed in the browser. Relative imports only.

import type { MonsterListing } from './adventure';
import type { ContentPin } from './versions';

export interface PartyPreview {
	id: string;
	name: string;
	/** e.g. "Orc Fighter 1 (Soldier)". */
	title: string | null;
	hp: number;
	defense: { name: string; value: number };
	/** In cells. */
	speed: number;
}

export interface AdventurePreview {
	rules: { id: string; version: number; name: string };
	/** The content its rules read (the SRD catalog by source and build). */
	content: ContentPin[];
	party: PartyPreview[];
	/** Players may build their own characters too. */
	openParty: boolean;
	monsters: MonsterListing[];
	/** The rules' credit, shown with their content. */
	attribution: string | null;
}
