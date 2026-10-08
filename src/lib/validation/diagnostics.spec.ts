// Diagnostics (milestone 56): one shape for what is wrong with content, with
// codes that never change meaning, and the adventure file's own diagnosis.

import { describe, expect, it } from 'vitest';
import { diagnoseAdventureFile, loadAdventureFile } from '../adventure/file';
import { exampleAdventure } from '../adventure/example';
import { codeOfProblem } from '../adventure/validate';
import {
	DIAGNOSTIC_CODES,
	DIAGNOSTICS,
	DIAGNOSTICS_MAX,
	diagnostic,
	firstError,
	fromProblem,
	hintOf,
	isDiagnostic,
	validationOf,
	VALIDATORS
} from './diagnostics';

const file = () => JSON.parse(JSON.stringify(exampleAdventure()));

describe('diagnostics', () => {
	it('keeps every code it has ever had, each with a hint', () => {
		// Codes are never renamed or reused: this list only grows.
		expect(DIAGNOSTIC_CODES).toEqual(
			expect.arrayContaining([
				'format.unknown',
				'format.newer',
				'schema.value',
				'schema.unknown_field',
				'ref.missing',
				'ref.reserved',
				'dice.invalid',
				'story.structure',
				'map.placement',
				'rules.unknown',
				'rules.mismatch',
				'rules.check',
				'content.markup',
				'content.srd_name',
				'dependency.missing',
				'dependency.unavailable',
				'dependency.incompatible',
				'dependency.invalid',
				'access.denied',
				'version.source',
				'version.rebuilt',
				'character.invalid',
				'save.invalid'
			])
		);
		for (const code of DIAGNOSTIC_CODES) expect(hintOf(code)).toBe(DIAGNOSTICS[code]);
	});

	it('splits a reader’s "path: message" problem and builds a validation', () => {
		expect(fromProblem('chapters.x.next.on: no event "y"', 'ref.missing')).toEqual({
			code: 'ref.missing',
			severity: 'error',
			path: 'chapters.x.next.on',
			message: 'no event "y"'
		});
		expect(fromProblem('too big', 'schema.value').path).toBe('');
		const warned = validationOf(
			'save',
			[diagnostic('version.rebuilt', 'lock', 'rebuilt', 'warning')],
			10
		);
		expect(warned).toMatchObject({
			kind: 'save',
			ok: true,
			validator: { id: VALIDATORS.save.id, version: 2, format: 10 }
		});
		const failed = validationOf(
			'adventure',
			Array.from({ length: DIAGNOSTICS_MAX + 5 }, (_, i) =>
				diagnostic('schema.value', `f${i}`, 'bad')
			)
		);
		expect(failed.ok).toBe(false);
		expect(failed.diagnostics).toHaveLength(DIAGNOSTICS_MAX);
		expect(firstError(failed.diagnostics)).toBe('f0: bad');
		expect(firstError(warned.diagnostics)).toBeNull();
	});

	it('recognises a diagnostic read off the wire, and nothing else', () => {
		expect(isDiagnostic(diagnostic('dice.invalid', 'a', 'b'))).toBe(true);
		expect(isDiagnostic({ code: 'made.up', severity: 'error', path: '', message: '' })).toBe(false);
		expect(isDiagnostic({ code: 'dice.invalid', severity: 'fatal', path: '', message: '' })).toBe(
			false
		);
		expect(isDiagnostic(null)).toBe(false);
	});

	it('names the kind of every problem the adventure checker words', () => {
		expect(codeOfProblem('enemy rat: bad dice "1d7"')).toBe('dice.invalid');
		expect(codeOfProblem('chapter the_mill: no event "nope"')).toBe('ref.missing');
		expect(codeOfProblem('fight ambush: "ambush" is the GM\'s own')).toBe('ref.reserved');
		expect(codeOfProblem('start: the first chapter is played elsewhere')).toBe('story.structure');
	});
});

describe('an adventure file’s diagnosis', () => {
	it('finds nothing in the example', () => {
		const d = diagnoseAdventureFile(file(), 'custom-x');
		expect(d.diagnostics).toEqual([]);
		expect(d.format).toBe(VALIDATORS.adventure.reads.at(-1));
		expect(d.adventure).not.toBeNull();
	});

	it('refuses a field it doesn’t know, never dropping it silently', () => {
		const f = file();
		f.chapters.the_mill.mood = 'grim';
		f.secret = true;
		const d = diagnoseAdventureFile(f, 'custom-x');
		expect(d.diagnostics).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: 'schema.unknown_field', path: 'chapters.the_mill.mood' }),
				expect.objectContaining({ code: 'schema.unknown_field', path: 'secret' })
			])
		);
		const loaded = loadAdventureFile(f, 'custom-x');
		expect(loaded.ok).toBe(false);
	});

	it('gives references, dice, values and formats their codes and paths', () => {
		const f = file();
		f.chapters.the_mill.next.on = 'nowhere';
		expect(diagnoseAdventureFile(f, 'custom-x').diagnostics).toEqual([
			{
				code: 'ref.missing',
				severity: 'error',
				path: 'chapter the_mill',
				message: 'no event "nowhere"'
			}
		]);
		const g = file();
		g.enemies.rat.attacks[0].damage = 'two dice';
		expect(diagnoseAdventureFile(g, 'custom-x').diagnostics).toEqual([
			expect.objectContaining({ code: 'dice.invalid', path: 'enemies.rat.attacks[0].damage' })
		]);
		expect(diagnoseAdventureFile({ ...file(), title: 7 }, 'custom-x').diagnostics[0]).toMatchObject(
			{
				code: 'schema.value',
				path: 'title'
			}
		);
		expect(diagnoseAdventureFile({ ...file(), format: 'zip' }, 'x').diagnostics[0].code).toBe(
			'format.unknown'
		);
		expect(diagnoseAdventureFile({ ...file(), version: 99 }, 'x').diagnostics[0]).toMatchObject({
			code: 'format.newer',
			path: 'version'
		});
	});
});
