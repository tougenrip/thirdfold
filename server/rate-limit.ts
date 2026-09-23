/**
 * Token bucket per key: `capacity` actions in a burst, refilled at
 * `refillPerSecond`. Keeps one client from flooding a room.
 */
export class RateLimiter {
	private buckets = new Map<string, { tokens: number; updated: number }>();

	constructor(
		private capacity: number,
		private refillPerSecond: number
	) {}

	take(key: string, now = Date.now()): boolean {
		const bucket = this.buckets.get(key) ?? { tokens: this.capacity, updated: now };
		const refilled = ((now - bucket.updated) / 1000) * this.refillPerSecond;
		bucket.tokens = Math.min(this.capacity, bucket.tokens + refilled);
		bucket.updated = now;
		this.buckets.set(key, bucket);
		if (bucket.tokens < 1) return false;
		bucket.tokens -= 1;
		return true;
	}

	forget(key: string): void {
		this.buckets.delete(key);
	}
}
