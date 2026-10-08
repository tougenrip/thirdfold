import { describe, expect, it } from 'vitest';
import { srdCatalog } from './catalog';
import {
	attackReasons,
	CONDITIONS,
	exhaustionOf,
	expand,
	incapacitatedBy,
	speedWith,
	testReasons
} from './conditions';
import { dnd55e } from './index';

const catalog = srdCatalog();
const held = (...ids: string[]) => ids.map((id) => ({ id, source: null, sourceSeen: false }));

describe('the SRD’s conditions at the table', () => {
	it('reads every condition from the SRD’s own words, all fifteen', () => {
		const tagged = catalog.all('rule').filter((r) => r.data.tag === 'Condition');
		expect(CONDITIONS.map((c) => c.name).sort()).toEqual(tagged.map((r) => r.name).sort());
		for (const c of CONDITIONS) {
			const text = catalog.named('rule', c.name)!.text;
			for (const phrase of c.phrases) expect(text, `${c.name}: ${phrase}`).toContain(phrase);
		}
		expect(dnd55e.conditions!.list().find((c) => c.id === 'petrified')!.notPlayed).toContain(
			'Resistance to all damage'
		);
	});

	it('brings the conditions a condition includes, and keeps its bearer from acting', () => {
		expect(expand(held('unconscious')).map((h) => h.id)).toEqual([
			'unconscious',
			'incapacitated',
			'prone'
		]);
		expect(incapacitatedBy(held('poisoned', 'stunned'))).toBe('Stunned');
		expect(incapacitatedBy(held('poisoned'))).toBeNull();
		expect(speedWith(held('restrained'), 6)).toBe(0);
		expect(dnd55e.conditions!.leaves('unconscious')).toEqual(['prone']);
	});

	it('turns conditions into advantage, disadvantage and critical hits', () => {
		expect(attackReasons(held('poisoned'), held('restrained'), false, null)).toEqual({
			advantages: ['restrained target'],
			disadvantages: ['poisoned attacker'],
			autoCrit: false
		});
		// Prone: advantage from beside, disadvantage from afar.
		expect(attackReasons([], held('prone'), true, null).advantages).toEqual(['prone target']);
		expect(attackReasons([], held('prone'), false, null).disadvantages).toEqual(['prone target']);
		// Paralyzed: a hit from within 5 feet is a critical one.
		expect(attackReasons([], held('paralyzed'), true, null).autoCrit).toBe(true);
		// Frightened only while its source is in sight; Grappled not against the grappler.
		const fear = [{ id: 'frightened', source: 'shade', sourceSeen: false }];
		expect(attackReasons(fear, [], false, null).disadvantages).toEqual([]);
		const grip = [{ id: 'grappled', source: 'guard', sourceSeen: true }];
		expect(attackReasons(grip, [], false, 'guard').disadvantages).toEqual([]);
		expect(attackReasons(grip, [], false, 'shade').disadvantages).toEqual(['grappled attacker']);
	});

	it('fails and hinders tests as the conditions say, and counts Exhaustion in levels', () => {
		expect(testReasons(held('stunned'), 'save', 'dex', false).fail).toContain('Stunned');
		expect(testReasons(held('stunned'), 'save', 'wis', false).fail).toBeNull();
		expect(testReasons(held('restrained'), 'save', 'dex', false).disadvantages).toEqual([
			'restrained'
		]);
		expect(testReasons(held('blinded'), 'check', 'wis', true).fail).toContain('sight');
		const tired = [{ id: 'exhaustion', source: null, sourceSeen: false, level: 2 }];
		expect(exhaustionOf(tired)).toBe(2);
		expect(speedWith(tired, 6)).toBe(4);
		expect(dnd55e.conditions!.deadly([{ ...tired[0], level: 6 }])).toBe(true);
	});
});
