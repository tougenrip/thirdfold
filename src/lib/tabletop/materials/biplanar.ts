// Biplanar mapping (Quílez, "Biplanar mapping") for rock on the low tier (#241): of triplanar's
// three projections only the two the normal faces most, so two fetches a slot instead of three,
// and no normal map (strength 0: the surface's own normal). The tier picks it when the pipeline is
// built (rock's graph without `antiTiled`), never at runtime; medium and up keep triplanar.

import { slotSample } from './hooks';
import { triplanarSharpness, type Mapping } from './mapping';
import type { SlotName } from './defaults';
import { tsl, type N } from './tsl';

/** Below this a projection's weight is nothing: |n| of a 45° diagonal across three axes. */
const DIAGONAL = 0.5773;

export function biplanar(repeat: N): Mapping {
	const p = tsl.positionWorld.mul(repeat.x);
	const a = tsl.normalWorldGeometry.normalize().abs();
	const [x, y, z] = [a.x, a.y, a.z];
	// The major axis (ties as `dominantAxis`: x, then y), the minor one, and the median between.
	const majX = x.greaterThanEqual(y).and(x.greaterThanEqual(z));
	const majY = majX.not().and(y.greaterThanEqual(z));
	const minX = majX.not().and(x.lessThanEqual(y)).and(x.lessThanEqual(z));
	const minY = majY.not().and(minX.not()).and(y.lessThanEqual(z));
	const medX = majX.not().and(minX.not());
	const medY = majY.not().and(minY.not());
	const project = (onX: N, onY: N) => onX.select(p.zy, onY.select(p.xz, p.xy));
	const [major, median] = [project(majX, majY), project(medX, medY)];
	const weight = (onX: N, onY: N) => onX.select(x, onY.select(y, z));
	const raw = tsl
		.vec2(weight(majX, majY), weight(medX, medY))
		.sub(DIAGONAL)
		.div(1 - DIAGONAL)
		.saturate()
		.pow(tsl.vec2(triplanarSharpness.div(8)));
	const w = tsl.vec2(tsl.max(raw.x, 1e-3), raw.y);
	return {
		sample(slot: SlotName) {
			const ref = slotSample(slot, major) as N & { node: N };
			return ref.mul(w.x).add(ref.node.sample(median).mul(w.y)).div(w.x.add(w.y));
		},
		normal: () => tsl.normalView.normalize()
	};
}
