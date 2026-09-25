// Weapons and armor, from the Weapons and Armor tables of "Equipment". Each
// table runs across both columns: the name, damage (or Armor Class) and
// properties on the left; mastery, weight and cost (or Strength, Stealth,
// weight and cost) on the right. Category rows ("Martial Ranged Weapons",
// "Medium Armor (5 Minutes to Don and 1 Minute to Doff)") set what follows.

import type { CatalogRecord } from '../../../../src/lib/content/catalog';
import type { SrdDocument } from './document';
import { record } from './entries';
import type { ArmorData, WeaponData } from './records';
import { tableRows, tableTitle, type TableRow } from './tables';

const DAMAGE_TYPES =
	'Acid|Bludgeoning|Cold|Fire|Force|Lightning|Necrotic|Piercing|Poison|Psychic|Radiant|Slashing|Thunder';
const WEAPON = new RegExp(`^(.+?) (\\d+d\\d+|\\d+) (${DAMAGE_TYPES}) (.+)$`);
const WEAPON_RIGHT = /^(\w+) (.+? lb\.|—) (\d[\d,]* [CSEGP]P)$/;
const WEAPON_CATEGORY = /^(Simple|Martial) (Melee|Ranged) Weapons$/;

/** Commas outside parentheses separate properties: "Ammunition (Range 80/320; Bolt), Loading". */
function properties(text: string): string[] {
	if (text === '—') return [];
	const out: string[] = [];
	let depth = 0;
	let current = '';
	for (const ch of text) {
		if (ch === '(') depth++;
		if (ch === ')') depth--;
		if (ch === ',' && depth === 0) {
			out.push(current.trim());
			current = '';
		} else current += ch;
	}
	if (current.trim()) out.push(current.trim());
	return out;
}

export function parseWeapons(doc: SrdDocument): CatalogRecord<'weapon', WeaponData>[] {
	const title = tableTitle(doc, doc.range(['Equipment', 'Weapons']), 'Weapons');
	const rows = tableRows(doc, title).slice(1);
	const out: { row: TableRow; wraps: string[]; category: RegExpExecArray }[] = [];
	let category: RegExpExecArray | null = null;
	for (const row of rows) {
		const c = WEAPON_CATEGORY.exec(row.left.text);
		if (c) category = c;
		else if (row.right && category) out.push({ row, wraps: [], category });
		else if (out.length) out[out.length - 1].wraps.push(row.left.text);
		else
			doc.note({
				kind: 'note',
				at: 'Weapons table',
				message: `Row not read: "${row.left.text}".`,
				pages: [row.left.page]
			});
	}
	return out.flatMap(({ row, wraps, category }) => {
		const left = [row.left.text, ...wraps].join(' ');
		const w = WEAPON.exec(left);
		const r = WEAPON_RIGHT.exec(row.right!.text);
		if (!w || !r) {
			doc.note({
				kind: 'skipped',
				at: 'Weapons table',
				message: `Row not read: "${left}" / "${row.right!.text}".`,
				pages: [row.left.page]
			});
			return [];
		}
		const props = properties(w[4]);
		const range = /\(Range (\d+)\/(\d+)/.exec(w[4]);
		const versatile = /Versatile \(([^)]+)\)/.exec(w[4]);
		const ammunition = /Ammunition \(Range [^;]+; (\w+)\)/.exec(w[4]);
		const data: WeaponData = {
			category: category[1].toLowerCase() as WeaponData['category'],
			type: category[2].toLowerCase() as WeaponData['type'],
			damage: w[2],
			damageType: w[3],
			properties: props,
			range: range ? { normal: Number(range[1]), long: Number(range[2]) } : null,
			versatile: versatile ? versatile[1] : null,
			ammunition: ammunition ? ammunition[1] : null,
			mastery: r[1],
			weight: r[2],
			cost: r[3]
		};
		const text = `${w[1]}: ${category[0].replace(/s$/, '')}. ${w[2]} ${w[3]}. Properties: ${w[4]}. Mastery: ${r[1]}. Weight: ${r[2]}. Cost: ${r[3]}.`;
		const lines = row.right ? [row.left, row.right] : [row.left];
		return [record(doc, 'weapon', w[1], data, [text], lines, row.index)];
	});
}

const ARMOR_CATEGORY = /^(Light|Medium|Heavy) Armor \((.+)\)$|^Shield \((.+)\)$/;
const ARMOR = /^(.+?) (\+?\d+(?: \+ Dex modifier(?: \(max (\d+)\))?)?)$/;
const ARMOR_RIGHT = /^(—|Str (\d+)) (—|Disadvantage) (.+? lb\.) (\d[\d,]* [CSEGP]P)$/;

export function parseArmor(doc: SrdDocument): CatalogRecord<'armor', ArmorData>[] {
	const title = tableTitle(doc, doc.range(['Equipment', 'Armor']), 'Armor');
	const rows = tableRows(doc, title).slice(1);
	const out: CatalogRecord<'armor', ArmorData>[] = [];
	let category: ArmorData['category'] | null = null;
	let don = '';
	for (const row of rows) {
		const c = ARMOR_CATEGORY.exec(row.left.text);
		if (c) {
			category = (c[1]?.toLowerCase() ?? 'shield') as ArmorData['category'];
			don = c[2] ?? c[3];
			continue;
		}
		const a = ARMOR.exec(row.left.text);
		const r = row.right && ARMOR_RIGHT.exec(row.right.text);
		if (!category || !a || !r) {
			doc.note({
				kind: 'skipped',
				at: 'Armor table',
				message: `Row not read: "${row.left.text}" / "${row.right?.text ?? ''}".`,
				pages: [row.left.page]
			});
			continue;
		}
		const dex = /Dex modifier/.test(a[2]);
		const data: ArmorData = {
			category,
			armorClass: a[2],
			base: Number(a[2].replace(/^\+/, '').split(' ')[0]),
			dexCap: !dex ? 0 : a[3] ? Number(a[3]) : null,
			strength: r[2] ? Number(r[2]) : null,
			stealthDisadvantage: r[3] === 'Disadvantage',
			weight: r[4],
			cost: r[5],
			don
		};
		const kind =
			category === 'shield' ? 'Shield' : `${category[0].toUpperCase()}${category.slice(1)} Armor`;
		const text = `${a[1]}: ${kind} (${don}). Armor Class: ${a[2]}. Strength: ${r[1]}. Stealth: ${r[3]}. Weight: ${r[4]}. Cost: ${r[5]}.`;
		out.push(record(doc, 'armor', a[1], data, [text], [row.left, row.right!], row.index));
	}
	return out;
}
