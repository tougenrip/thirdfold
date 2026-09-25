// Checking an imported catalog before it is used: every record has a
// well-formed, unique id of its kind, provenance naming the pinned source
// and real pages, and the fields its kind needs in range; and the records
// agree with each other (a spell's classes are classes, a background's feat
// is a feat, a subclass's class exists). Returns the problems, empty when
// the catalog is sound.

import { slugOf } from '../../../../src/lib/content/catalog';
import { parseDice } from '../../../../src/lib/game/dice';
import { ABILITIES, proficiencyBonus, SKILLS } from '../core';
import type { CatalogManifest } from './importer';
import { SRD_KINDS, type SrdKind, type SrdRecord } from './records';
import { SRD_521 } from './source';

const SCHOOLS = [
	'Abjuration',
	'Conjuration',
	'Divination',
	'Enchantment',
	'Evocation',
	'Illusion',
	'Necromancy',
	'Transmutation'
];
const PAGES = 364;
const ID = /^srd-5\.2\.1:([a-z]+):([a-z0-9]+(?:-[a-z0-9]+)*)$/;

export function validateCatalog(
	manifest: CatalogManifest,
	records: Record<SrdKind, SrdRecord[]>
): string[] {
	const problems: string[] = [];
	const bad = (at: string, message: string) => problems.push(`${at}: ${message}`);
	if (manifest.source.sha256 !== SRD_521.sha256)
		bad('manifest', 'source is not the pinned SRD 5.2.1');
	if (manifest.source.attribution !== SRD_521.attribution) bad('manifest', 'attribution changed');

	const ids = new Set<string>();
	const names = (kind: SrdKind) => new Set(records[kind].map((r) => r.name));
	const classes = names('class');
	const feats = names('feat');
	const skills = new Set(SKILLS.map((s) => s.name));
	const abilities = new Set(ABILITIES.map((a) => a.name));

	for (const kind of SRD_KINDS) {
		if (manifest.files[kind]?.count !== records[kind].length)
			bad(kind, 'count differs from the manifest');
		for (const r of records[kind]) {
			const at = r.id;
			const m = ID.exec(r.id);
			if (!m || m[1] !== kind || r.kind !== kind) bad(at, `not a ${kind} id`);
			else if (!m[2].endsWith(slugOf(r.name).split('-').at(-1)!))
				bad(at, `id does not name "${r.name}"`);
			if (ids.has(r.id)) bad(at, 'id used twice');
			ids.add(r.id);
			if (!r.name.trim()) bad(at, 'no name');
			if (!r.text.trim()) bad(at, 'no text');
			const p = r.provenance;
			if (p.source !== SRD_521.id) bad(at, 'provenance names another source');
			if (!p.section.length) bad(at, 'no section');
			if (
				!p.pages.length ||
				p.pages.some((n, i) => n < 1 || n > PAGES || (i > 0 && n <= p.pages[i - 1]))
			)
				bad(at, 'pages out of order or out of the source');
			checkData(r, at, bad, { classes, feats, skills, abilities });
		}
	}
	return problems;
}

function checkData(
	r: SrdRecord,
	at: string,
	bad: (at: string, message: string) => void,
	known: { classes: Set<string>; feats: Set<string>; skills: Set<string>; abilities: Set<string> }
): void {
	const dice = (d: string) => /^\d+$/.test(d) || parseDice(d).ok;
	switch (r.kind) {
		case 'spell': {
			const d = r.data;
			if (!Number.isInteger(d.level) || d.level < 0 || d.level > 9) bad(at, 'level out of 0–9');
			if (!SCHOOLS.includes(d.school)) bad(at, `no school "${d.school}"`);
			for (const c of d.classes) if (!known.classes.has(c)) bad(at, `no class "${c}"`);
			if (!d.castingTime || !d.range || !d.duration) bad(at, 'a field is empty');
			if (d.level === 0 && d.higherLevels) bad(at, 'a cantrip with higher-level text');
			break;
		}
		case 'weapon': {
			const d = r.data;
			if (!dice(d.damage)) bad(at, `bad damage "${d.damage}"`);
			if (d.versatile && !dice(d.versatile)) bad(at, `bad versatile damage "${d.versatile}"`);
			if (d.range && !(d.range.normal > 0 && d.range.long >= d.range.normal)) bad(at, 'bad range');
			if (!d.mastery || !d.cost) bad(at, 'no mastery or cost');
			break;
		}
		case 'armor': {
			const d = r.data;
			if (!(d.base > 0)) bad(at, 'no Armor Class');
			if (d.category !== 'shield' && d.base < 10) bad(at, 'Armor Class below 10');
			break;
		}
		case 'species':
			if (!(r.data.speed > 0)) bad(at, 'no speed');
			if (!r.data.traits.length) bad(at, 'no traits');
			break;
		case 'background': {
			const d = r.data;
			if (d.abilities.length !== 3 || d.abilities.some((a) => !known.abilities.has(a)))
				bad(at, 'not three abilities');
			if (!known.feats.has(d.feat.replace(/ \(.*\)$/, ''))) bad(at, `no feat "${d.feat}"`);
			if (d.skills.length !== 2 || d.skills.some((s) => !known.skills.has(s)))
				bad(at, 'not two skills');
			break;
		}
		case 'feat':
			break;
		case 'class': {
			const d = r.data;
			if (!/^D(6|8|10|12)$/.test(d.hitDie)) bad(at, `bad Hit Point Die "${d.hitDie}"`);
			if (d.savingThrows.length !== 2 || d.savingThrows.some((a) => !known.abilities.has(a)))
				bad(at, 'not two saving throws');
			d.levels.forEach((l, i) => {
				if (l.level !== i + 1) bad(at, `levels out of order at ${l.level}`);
				if (l.proficiencyBonus !== proficiencyBonus(l.level))
					bad(at, `level ${l.level}: Proficiency Bonus +${l.proficiencyBonus}`);
			});
			if (d.levels.length !== 20) bad(at, 'not 20 levels');
			if (!d.features.some((f) => f.level === 1)) bad(at, 'no level 1 feature');
			break;
		}
		case 'subclass':
			if (!known.classes.has(r.data.class)) bad(at, `no class "${r.data.class}"`);
			if (!r.data.features.length) bad(at, 'no features');
			break;
		case 'rule':
			break;
		case 'monster': {
			const d = r.data;
			if (Object.keys(d.abilities).length !== 6) bad(at, 'not six abilities');
			for (const [k, a] of Object.entries(d.abilities))
				if (a.modifier !== Math.floor((a.score - 10) / 2))
					bad(at, `${k} modifier does not match its score`);
			if (!(d.armorClass > 0) || !(d.hitPoints.average > 0)) bad(at, 'no AC or HP');
			if (d.hitPoints.formula && !parseDice(d.hitPoints.formula.replace(/[−–]/g, '-')).ok)
				bad(at, `bad HP formula "${d.hitPoints.formula}"`);
			if (!/^(\d+|1\/[248])$/.test(d.challenge.rating)) bad(at, `bad CR "${d.challenge.rating}"`);
			const blocks =
				d.traits.length +
				d.actions.length +
				d.bonusActions.length +
				d.reactions.length +
				d.legendaryActions.length;
			if (!blocks) bad(at, 'no traits, actions or reactions');
			break;
		}
	}
}
