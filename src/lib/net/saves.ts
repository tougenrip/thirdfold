// A GM's saves, listed from the landing page before any table is open: a
// short-lived socket asks the game server for the saves of this browser's GM
// key, and closes. The key never goes anywhere but that server.

import { GAME_SERVER_URL } from '$lib/api';
import { parseServerMessage, type SavedScene } from '$lib/game/protocol';

export function listSaves(
	gmKey: string,
	url = GAME_SERVER_URL,
	timeoutMs = 8000
): Promise<SavedScene[]> {
	return new Promise((resolve, reject) => {
		let ws: WebSocket;
		try {
			ws = new WebSocket(url);
		} catch (err) {
			reject(err);
			return;
		}
		const done = (fn: () => void) => {
			clearTimeout(timer);
			ws.onclose = null;
			ws.close();
			fn();
		};
		const timer = setTimeout(
			() => done(() => reject(new Error('The game server did not answer.'))),
			timeoutMs
		);
		ws.onopen = () => ws.send(JSON.stringify({ type: 'scene_list', gmKey }));
		ws.onmessage = (event) => {
			let data: unknown = null;
			try {
				data = JSON.parse(String(event.data));
			} catch {
				// ignore
			}
			const msg = parseServerMessage(data);
			if (msg?.type === 'scene_list') done(() => resolve(msg.scenes));
			else if (msg?.type === 'error') done(() => reject(new Error(msg.message)));
		};
		ws.onclose = () => done(() => reject(new Error('Cannot reach the game server.')));
	});
}
