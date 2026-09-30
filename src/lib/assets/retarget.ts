// Keeps what is drawn at the size texture detail wants (detail.ts): pure, loading through the
// function each tracked thing gives. Only tabletop/texture-detail.ts (a lazy chunk) uses it.

import { sizeFor, type TextureDetail } from './detail';
import { BASE_PX } from './manifest';

/** Something drawn at one of its sizes: the base when it loaded, then whatever `load` brought. */
export interface Tracked {
	sizes: readonly number[];
	current: number;
	/** Loads and swaps in `size`; rejects if it could not (a failed fetch, a bad file). */
	load(size: number): Promise<void>;
}

/**
 * Keeps what it tracks at the size the setting wants: on each change, and for each new one.
 * A size that fails to load falls back to the base (and, if that fails too, keeps what it has).
 */
export class Retargeter {
	private readonly items = new Set<Tracked>();
	private readonly queue = new Map<Tracked, Promise<void>>();

	constructor(private detail: TextureDetail) {}

	track(item: Tracked): Promise<void> {
		this.items.add(item);
		return this.retarget(item);
	}

	forget(item: Tracked): void {
		this.items.delete(item);
	}

	set(detail: TextureDetail): Promise<void> {
		this.detail = detail;
		return Promise.all([...this.items].map((item) => this.retarget(item))).then(() => {});
	}

	/** One item's loads one after another, each to the size wanted when it starts. */
	private retarget(item: Tracked): Promise<void> {
		const next = (this.queue.get(item) ?? Promise.resolve()).then(async () => {
			const want = sizeFor(item.sizes, this.detail);
			if (!this.items.has(item) || want === item.current) return;
			try {
				await item.load(want);
				item.current = want;
			} catch (err) {
				console.warn(`[assets] no ${want} px copy; drawing the base:`, (err as Error).message);
				if (item.current === BASE_PX) return;
				await item.load(BASE_PX).then(
					() => void (item.current = BASE_PX),
					() => {}
				);
			}
		});
		this.queue.set(item, next);
		return next;
	}
}
