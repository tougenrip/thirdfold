// A GM's lasting identity: a secret key the server issues to a GM's browser
// the first time they open a table, and which they can carry to another
// device. It is what makes saves theirs. The server never stores the key
// itself, only its SHA-256 (the "owner" of their saves), so a leaked store
// doesn't hand anyone the keys.

import { createHash, randomBytes } from 'node:crypto';

export function newGmKey(): string {
	return randomBytes(32).toString('hex');
}

/** Who a key's saves belong to. */
export function keyOwner(key: string): string {
	return createHash('sha256').update(key).digest('hex');
}
