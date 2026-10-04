// The lit kinds' lighting model (#228, "One dimming instead of two"): the rules' darkness is a
// matter of the light that has no source, so the light factor `worldLight` (world-modify.ts: how
// lit the cell is, 1 down to 1 - the ambient's darkness) scales the indirect light (the sky's
// hemisphere and image light, AO included) here and the key light in `SkyLightNode`, and the
// point lights (GridLights), which only shine on cells the rules light, are left as they are.
// `worldModify` then only fogs, tints and adds the dark's colour for these kinds; materials that
// are not kinds (fixtures, flames, the mist) keep its whole darkening. Later lighting tasks
// (translucency, #237; bounce and cavity, #234) belong here too. Bounce and cavity (#234): the
// GridLight's node (grid-light-node.ts) hands its reads over in `gridIndirect`; the bounce adds as
// diffuse irradiance, not dimmed by the light factor (it comes from the lights), and cavity
// multiplies the whole indirect light, as AO does.

import * as THREE from 'three/webgpu';
import * as T from 'three/tsl';
import { normalView, positionViewDirection } from 'three/tsl';
import { BAKE_ATTRIBUTE } from './kinds';
import { tsl, type N } from './tsl';
import { worldLight } from './world-modify';

type Context = { reflectedLight: Record<'indirectDiffuse' | 'indirectSpecular', N> };
type Direct = { lightDirection: N; lightColor: N; reflectedLight: Record<'directDiffuse', N> };

/** The kinds that take translucency (#237), and those of them whose geometry carries `aBake`. */
const TRANSLUCENT = new Set(['prop', 'mini', 'foliage']);
const BAKED = new Set(['prop', 'mini']);
/** Wrap diffuse: how far past the terminator (in N·L) light reaches; lit faces take none of it. */
const WRAP = 0.5;
/** Back light: the normal's pull on the scattered direction, and the term's peak. */
const DISTORTION = 0.2;
const TRANSMIT = 1.2;

/**
 * Fake translucency (#237, MeshSSSNodeMaterial's term plus wrap diffuse): light behind a thin,
 * waxy thing shines through it toward the viewer, tinted by its albedo; light past the terminator
 * wraps a little. Thin is where the bake is open (`aBake.x` near 1: no thickness occludes it),
 * else everywhere (foliage). Scaled by `params.translucency`, a uniform: 0 is off, compiling nothing.
 */
function translucency(kind: string, { lightDirection: l, lightColor, reflectedLight }: Direct) {
	const n = normalView as unknown as N;
	const v = positionViewDirection as unknown as N;
	const nl = n.dot(l);
	// A bump just past the terminator, 0 at N·L = 0 and at -WRAP: a face the light falls on is as it was.
	const wrap = tsl.max(nl.add(WRAP), 0).mul(nl.mul(-1 / WRAP).saturate());
	const back = tsl.max(v.dot(l.add(n.mul(DISTORTION)).normalize().negate()), 0);
	const b2 = back.mul(back);
	const thin = BAKED.has(kind) ? tsl.attribute(BAKE_ATTRIBUTE, 'vec2').x : 1;
	const through = b2.mul(b2).mul(TRANSMIT).mul(thin);
	const strength = tsl.materialReference('params.translucency', 'float');
	reflectedLight.directDiffuse.addAssign(
		(diffuseContribution as unknown as N).mul(lightColor).mul(
			wrap
				.add(through)
				.mul(strength)
				.mul(1 / Math.PI)
		)
	);
}

/** The grid's indirect light at a fragment (#234): bounce irradiance and the cavity factor. */
export interface GridIndirect {
	bounce: N;
	cavity: N;
}

const { BRDF_Lambert, diffuseContribution } = T as unknown as {
	BRDF_Lambert: (inputs: { diffuseColor: N }) => N;
	diffuseContribution: N;
};

export class KindLightingModel extends THREE.PhysicalLightingModel {
	/** Marks the kinds' model: `SkyLightNode` dims the key light by the light factor for it. */
	readonly isKindLighting = true;
	/** Set by the GridLight's node, which is built before `indirect` (null without one). */
	gridIndirect: GridIndirect | null = null;

	direct(input: THREE.LightingModelDirectInput, builder: THREE.NodeBuilder): void {
		const kind = (builder.material as { kind?: string }).kind;
		if (kind && TRANSLUCENT.has(kind)) translucency(kind, input as unknown as Direct);
		super.direct(input, builder);
	}

	indirect(builder: THREE.NodeBuilder): void {
		super.indirect(builder);
		const light = worldLight();
		const { reflectedLight } = builder.context as unknown as Context;
		reflectedLight.indirectDiffuse.mulAssign(light);
		reflectedLight.indirectSpecular.mulAssign(light);
		const coat = (this as unknown as { clearcoatSpecularIndirect?: N }).clearcoatSpecularIndirect;
		coat?.mulAssign(light);
		const grid = this.gridIndirect;
		if (!grid) return;
		const bounce = grid.bounce.mul(BRDF_Lambert({ diffuseColor: diffuseContribution }));
		reflectedLight.indirectDiffuse.addAssign(bounce);
		reflectedLight.indirectDiffuse.mulAssign(grid.cavity);
		reflectedLight.indirectSpecular.mulAssign(grid.cavity);
	}
}

/** Whether the material being built lights with the kinds' model. */
export const kindLit = (builder: THREE.NodeBuilder): boolean =>
	!!(builder.context as unknown as { lightingModel?: { isKindLighting?: boolean } }).lightingModel
		?.isKindLighting;

/** The standard base of the lit kinds. */
export class KindStandardMaterial extends THREE.MeshStandardNodeMaterial {
	setupLightingModel() {
		return new KindLightingModel();
	}
}

/** The physical base (minis: clearcoat). */
export class KindPhysicalMaterial extends THREE.MeshPhysicalNodeMaterial {
	setupLightingModel() {
		const m = this as unknown as Record<string, boolean>;
		return new KindLightingModel(
			m.useClearcoat,
			m.useSheen,
			m.useIridescence,
			m.useAnisotropy,
			m.useTransmission,
			m.useDispersion,
			m.useRetroreflection
		);
	}
}
