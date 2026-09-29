// Texture detail (docs/ASSETS.md "Texture detail"): which size of a texture or cooked model to
// draw. Every one has a base of at most 512 px, served with the page; some have 1K and 2K
// variants in the asset store. The Graphics menu's Texture detail (low, medium, high: at most
// 512, 1K, 2K) picks the largest size there is up to it. Without an asset host only the base is
// drawn, so CI, tests and the native shells always draw the same pixels.
//
// Pure but for the current setting and who follows it; keeping what is drawn at the size wanted
// is retarget.ts, and the loaders' three.js side tabletop/texture-detail.ts.

import { BASE_PX, type FileInfo, type Variant } from './manifest';

export const TEXTURE_DETAILS = ['low', 'medium', 'high'] as const;
export type TextureDetail = (typeof TEXTURE_DETAILS)[number];

/** The largest side each setting draws. */
export const DETAIL_PX: Record<TextureDetail, number> = { low: 512, medium: 1024, high: 2048 };

/** `?texture=low|medium|high` (tests, comparisons), or null. Never saved. */
export function textureDetailFrom(search: string): TextureDetail | null {
	const d = new URLSearchParams(search).get('texture');
	return TEXTURE_DETAILS.includes(d as TextureDetail) ? (d as TextureDetail) : null;
}

type Sized = Pick<FileInfo, 'file' | 'sha256'> & { variants?: Variant[] };

/** The sizes an entry has: the base's and its variants', smallest first. */
export const sizesOf = (entry: Sized): number[] => [
	BASE_PX,
	...(entry.variants ?? []).map((v) => v.size)
];

/** The largest of `sizes` (smallest first, the base first) at most `detail`'s; the base below all. */
export function sizeFor(sizes: readonly number[], detail: TextureDetail): number {
	return sizes.reduce((best, s) => (s <= DETAIL_PX[detail] ? s : best), sizes[0]);
}

/** The file an entry has at `size`: a variant's, else the base's. */
export function fileAt(entry: Sized, size: number): Pick<FileInfo, 'file' | 'sha256'> {
	return entry.variants?.find((v) => v.size === size) ?? entry;
}

let detail: TextureDetail = 'low';
const listeners = new Set<(d: TextureDetail) => void>();

/** The viewer's texture detail (QualityControl sets it from the tier and the Graphics menu). */
export const textureDetail = () => detail;

export function setTextureDetail(next: TextureDetail): void {
	if (next === detail) return;
	detail = next;
	for (const listen of listeners) listen(next);
}

export function onTextureDetail(listen: (d: TextureDetail) => void): void {
	listeners.add(listen);
}

const swapped = new Set<() => void>();

/** Told when a texture drawn now changed size (a table draws again); returns the unsubscribe. */
export function onTextureSwap(listen: () => void): () => void {
	swapped.add(listen);
	return () => swapped.delete(listen);
}

export function textureSwapped(): void {
	for (const listen of swapped) listen();
}
