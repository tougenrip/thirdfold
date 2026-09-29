// The asset turntable (#194) is a dev tool: production builds answer 404 here, and drop the
// turntable itself (Turntable.svelte and tabletop/turntable.ts; scripts/check-bundle.mjs checks).
import { error } from '@sveltejs/kit';

export function load(): void {
	if (!import.meta.env.DEV) error(404, 'Not found');
}
