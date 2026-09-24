// A GM's saves, listed from the landing page before any table is open: a
// short-lived socket asks the game server for the saves of this browser's GM
// key, and closes. The key never goes anywhere but that server.

import type { SavedScene } from '$lib/game/protocol';
import { ask } from './ask';

export async function listSaves(gmKey: string, url?: string): Promise<SavedScene[]> {
	return (await ask({ type: 'scene_list', gmKey }, 'scene_list', url)).scenes;
}
