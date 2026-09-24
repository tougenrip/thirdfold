// One question to the game server outside a table (the landing page, the
// library, the builder): a short-lived socket sends a message, waits for the
// answer of the expected type (or an error), and closes.

import { GAME_SERVER_URL } from '$lib/api';
import { parseServerMessage, type ClientMessage, type ServerMessage } from '$lib/game/protocol';

export function ask<T extends ServerMessage['type']>(
	message: ClientMessage,
	answer: T,
	url = GAME_SERVER_URL,
	timeoutMs = 8000
): Promise<Extract<ServerMessage, { type: T }>> {
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
		ws.onopen = () => ws.send(JSON.stringify(message));
		ws.onmessage = (event) => {
			let data: unknown = null;
			try {
				data = JSON.parse(String(event.data));
			} catch {
				// ignore
			}
			const msg = parseServerMessage(data);
			if (msg?.type === answer) done(() => resolve(msg as Extract<ServerMessage, { type: T }>));
			else if (msg?.type === 'error') done(() => reject(new Error(msg.message)));
		};
		ws.onclose = () => done(() => reject(new Error('Cannot reach the game server.')));
	});
}
