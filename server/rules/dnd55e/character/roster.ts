// Who each fifth edition character belongs to, kept beside the characters
// rather than in them: a character's JSON says nothing of its owner, so
// sharing, copying or showing one never gives its owner away. An owner is
// an opaque id (a GM key's hash, a player's seat), never shown to others.

import type { DndCharacter } from './model';

export class CharacterRoster {
	private readonly characters = new Map<string, DndCharacter>();
	private readonly owners = new Map<string, string>();

	private static key(owner: string, id: string) {
		return `${owner}\n${id}`;
	}

	/** Adds an owner's character, or replaces theirs of the same id (ids are per owner). */
	put(owner: string, character: DndCharacter): void {
		const key = CharacterRoster.key(owner, character.id);
		this.characters.set(key, character);
		this.owners.set(key, owner);
	}

	get(owner: string, id: string): DndCharacter | undefined {
		return this.characters.get(CharacterRoster.key(owner, id));
	}

	/** An owner's characters, by id. */
	list(owner: string): DndCharacter[] {
		return [...this.characters.entries()]
			.filter(([key]) => this.owners.get(key) === owner)
			.map(([, c]) => c)
			.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
	}

	remove(owner: string, id: string): boolean {
		const key = CharacterRoster.key(owner, id);
		this.owners.delete(key);
		return this.characters.delete(key);
	}
}
