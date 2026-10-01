// The SRD's monsters as enemies the table plays (milestone 51). Each stat
// block in the catalog (srd/monsters.ts imported them as printed) is read
// into the engine's `EnemyDef`: Armor Class, average Hit Points, walking
// Speed, initiative, saving throws, damage and condition immunities,
// Resistances and Vulnerabilities, and its attacks, from the action lines
// the SRD writes the same way ("Melee Attack Roll: +4, reach 5 ft. Hit: 5
// (1d6 + 2) Slashing damage."), a Multiattack that repeats one attack, and
// tactics from what it has (melee: it closes in; a ranged attack too: it
// keeps its distance). What the table doesn't play yet (traits, spells,
// saving-throw actions such as breath, riders on a hit) is listed by name,
// never approximated; a monster with no attack the table can play isn't
// offered.
//
// The encounter summary is the SRD's own guidance (Gameplay Toolbox,
// "Combat Encounter Difficulty"): a budget per character by level, for
// Low, Moderate and High difficulty, against the monsters' XP. Advisory:
// it says what it assumes, and promises no balance.
//
// This work includes material from the SRD 5.2.1; see core.ts.

import type { EncounterSummary, MonsterListing } from '../../../src/lib/adventure/adventure';
import type { Attack } from '../../../src/lib/adventure/characters';
import type { Behavior, EnemyDef } from '../../../src/lib/adventure/define';
import type { Bestiary } from '../ruleset';
import type { Catalog, RecordOf } from './catalog';
import { CONDITIONS } from './conditions';
import { DAMAGE_TYPES } from './sheet';

const FEET_PER_CELL = 5;
/** Kinds the table plays SRD monsters by: `srd-<slug>`. */
const PREFIX = 'srd-';
const slugOf = (id: string) => id.slice(id.lastIndexOf(':') + 1);
export const kindOf = (id: string) => `${PREFIX}${slugOf(id)}`;

/** A stat block read for the table: the enemy it plays as (null when none of it can be played), and its listing. */
export interface Monster {
	id: string;
	enemy: EnemyDef | null;
	listing: MonsterListing;
}

const NUMBERS: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, six: 6 };

const ATTACK =
	/^(Melee|Ranged|Melee or Ranged) Attack Roll: ([+-]\d+), (?:reach (\d+) ft\.)?(?: or )?(?:range (\d+)\/\d+ ft\.)?\s*Hit: (\d+)(?: \(([^)]+)\))? ([A-Za-z]+) damage/;

/** One action line as an attack, and whether anything after its damage isn't played. */
export function readAttack(
	name: string,
	text: string
): { attack: Attack; melee: boolean; rider: boolean } | null {
	// The SRD prints minus as "−" or "–" (1d4 − 1).
	text = text.replace(/[\u2212\u2013]/g, '-');
	const m = ATTACK.exec(text);
	if (!m) return null;
	const [, kind, bonus, reach, range, flat, dice, type] = m;
	const melee = kind !== 'Ranged' && reach !== undefined;
	const cells = melee
		? Math.max(1, Number(reach) / FEET_PER_CELL)
		: Math.max(2, Number(range ?? 0) / FEET_PER_CELL);
	const damageType = type.toLowerCase();
	if (!DAMAGE_TYPES.includes(damageType)) return null;
	let rest = text.slice(m.index + m[0].length).trim();
	// What the table plays after the damage: more damage of another type, and being knocked Prone.
	// Only damage that always comes with the hit: "… damage if the attack roll had Advantage" isn't played.
	const plus = /^,?\s*plus (\d+) \(([^)]+)\) ([A-Za-z]+) damage(?=\.|$)\.?/.exec(rest);
	const plusType = plus?.[3].toLowerCase();
	if (plus) rest = rest.slice(plus[0].length).trim();
	const prone =
		/^\.? ?If the target is an? (?:Tiny|Small|Medium|Large|Huge|Gargantuan) or smaller creature, it has the Prone condition\.$/.exec(
			rest
		);
	if (prone) rest = '';
	return {
		attack: {
			name,
			range: Math.min(cells, 20),
			toHit: Number(bonus),
			damage: dice ? dice.replace(/\s+/g, '') : flat,
			damageType,
			...(plus && plusType && DAMAGE_TYPES.includes(plusType)
				? { plus: { damage: plus[2].replace(/\s+/g, ''), damageType: plusType } }
				: {}),
			...(prone ? { inflicts: { conditions: ['prone'], ends: null } } : {})
		},
		melee,
		rider: rest !== '' && rest !== '.'
	};
}

/** A stat block's line of words as damage types and conditions ("Poison; Exhaustion, Poisoned"). */
function traitWords(line: string | undefined): { damage: string[]; conditions: string[] } {
	const words = (line ?? '')
		.split(/[;,]/)
		.map((w) => w.trim().toLowerCase())
		.filter(Boolean);
	return {
		damage: words.filter((w) => DAMAGE_TYPES.includes(w)),
		conditions: words.filter((w) => CONDITIONS.some((c) => c.id === w))
	};
}

/** The figure and colour a monster is drawn as, by what it is. */
function lookOf(type: string, name: string): { model: string; color: string } {
	const t = type.toLowerCase();
	if (/shadow|ghost|specter|wraith|wight|banshee/i.test(name))
		return { model: 'hatted-shade', color: '#5dade2' };
	if (t.startsWith('beast') || t.startsWith('monstrosity'))
		return { model: 'hound', color: '#8d6e63' };
	if (t.startsWith('humanoid') || t.startsWith('fey'))
		return { model: 'robed-figure', color: '#a04000' };
	if (t.startsWith('aberration') || t.startsWith('ooze') || t.startsWith('plant'))
		return { model: 'pulsing-mass', color: '#7d3c98' };
	return { model: 'armored-brute', color: '#7f8c8d' };
}

/** Reads one stat block. */
export function readMonster(record: RecordOf<'monster'>): Monster {
	const d = record.data;
	const notPlayed: string[] = d.traits.map((t) => t.name);
	const parsed: { attack: Attack; melee: boolean }[] = [];
	let multi: { times: number; name: string | null; whole: boolean } | null = null;
	for (const a of d.actions) {
		if (a.name === 'Multiattack') {
			const one = /makes (two|three|four|five|six) ([A-Z][\w’' -]*?) attacks/.exec(a.text);
			const any = /makes (two|three|four|five|six) attacks/.exec(a.text);
			const hit = one ?? any;
			// Only a Multiattack of one attack, repeated, is played as it is written.
			const whole = !!one && /^[^.]*\.$/.test(a.text.trim());
			multi = hit ? { times: NUMBERS[hit[1]], name: one ? one[2] : null, whole } : null;
			if (!hit) notPlayed.push(a.name);
			continue;
		}
		const read = readAttack(a.name, a.text);
		if (!read) {
			notPlayed.push(a.name);
			continue;
		}
		parsed.push(read);
		if (read.rider) notPlayed.push(`${a.name} (what follows its damage)`);
	}
	for (const b of [...d.bonusActions, ...d.reactions, ...d.legendaryActions])
		notPlayed.push(b.name);

	const named = (n: string | null) =>
		n ? parsed.find((p) => p.attack.name.toLowerCase() === n.toLowerCase()) : undefined;
	const repeated =
		named(multi?.name ?? null) ??
		(multi && !multi.name
			? parsed.find((p) =>
					d.actions.some((a) => a.name === 'Multiattack' && a.text.includes(p.attack.name))
				)
			: undefined);
	if (multi && !repeated) notPlayed.push('Multiattack');
	else if (multi && !multi.whole) notPlayed.push('Multiattack (in part)');
	const times = repeated && multi ? multi.times : 1;
	const withTimes = (p: { attack: Attack }) =>
		p === repeated && times > 1 ? { ...p.attack, times } : p.attack;
	const melee = (repeated?.melee ? repeated : undefined) ?? parsed.find((p) => p.melee);
	const ranged =
		(repeated && !repeated.melee ? repeated : undefined) ?? parsed.find((p) => !p.melee);
	const attacks: Attack[] =
		melee && ranged
			? [withTimes(melee), withTimes(ranged)]
			: melee
				? [withTimes(melee)]
				: ranged
					? [withTimes(ranged), withTimes(ranged)]
					: [];
	for (const p of parsed)
		if (p !== melee && p !== ranged) notPlayed.push(`${p.attack.name} (not among its tactics)`);
	const behavior: Behavior = melee && !ranged ? 'rush' : 'skirmish';

	const speed = /(\d+) ft\./.exec(d.speed);
	const senses = [
		...(d.details.Senses ?? '').matchAll(/(?:Darkvision|Blindsight|Truesight) (\d+) ft\./g)
	];
	const sight = Math.max(60, ...senses.map((s) => Number(s[1])));
	const immune = traitWords(d.details.Immunities);
	const resist = traitWords(d.details.Resistances).damage;
	const vulnerable = traitWords(d.details.Vulnerabilities).damage;
	const hp = d.hitPoints.average;
	const look = lookOf(d.type, record.name);
	const kind = kindOf(record.id);
	const enemy: EnemyDef | null = attacks.length
		? {
				kind,
				name: record.name,
				model: look.model,
				color: look.color,
				armor: d.armorClass,
				speed: speed ? Math.max(1, Math.floor(Number(speed[1]) / FEET_PER_CELL)) : 0,
				vision: Math.min(24, Math.floor(sight / FEET_PER_CELL)),
				light: 0,
				initiative: d.initiative.bonus,
				hp: () => hp,
				attacks,
				saves: Object.fromEntries(Object.entries(d.abilities).map(([k, v]) => [k, v.save])),
				...(immune.conditions.length ? { immune: immune.conditions } : {}),
				...(immune.damage.length || resist.length || vulnerable.length
					? {
							damage: {
								...(immune.damage.length ? { immune: immune.damage } : {}),
								...(resist.length ? { resist } : {}),
								...(vulnerable.length ? { vulnerable } : {})
							}
						}
					: {}),
				behavior
			}
		: null;
	const line = (a: Attack) =>
		`${a.name}${a.times ? ` ×${a.times}` : ''}: ${a.toHit >= 0 ? '+' : ''}${a.toHit}, ${
			a.range <= 2 ? `reach ${a.range * FEET_PER_CELL} ft.` : `range ${a.range * FEET_PER_CELL} ft.`
		}, ${a.damage} ${a.damageType}${a.plus ? ` plus ${a.plus.damage} ${a.plus.damageType}` : ''}${
			a.inflicts ? `, knocks Prone` : ''
		}`;
	const p = record.provenance;
	return {
		id: record.id,
		enemy,
		listing: {
			kind,
			name: record.name,
			type: `${d.size} ${d.type}`,
			challenge: d.challenge.rating,
			xp: d.challenge.xp,
			armorClass: d.armorClass,
			hitPoints: hp,
			attacks: [...new Set(attacks)].map(line),
			notPlayed: [...new Set(notPlayed)],
			source: `SRD 5.2.1, ${p.section.join(' › ')}, p. ${p.pages.join(', ')}`
		}
	};
}

/** The SRD's XP Budget per Character table (Gameplay Toolbox, "Combat Encounter Difficulty"), by level 1 to 20. */
export const XP_BUDGET: readonly [number, number, number][] = [
	[50, 75, 100],
	[100, 150, 200],
	[150, 225, 400],
	[250, 375, 500],
	[500, 750, 1100],
	[600, 1000, 1400],
	[750, 1300, 1700],
	[1000, 1700, 2100],
	[1300, 2000, 2600],
	[1600, 2300, 3100],
	[1900, 2900, 4100],
	[2200, 3700, 4700],
	[2600, 4200, 5400],
	[2900, 4900, 6200],
	[3300, 5400, 7800],
	[3800, 6100, 9800],
	[4500, 7200, 11700],
	[5000, 8700, 14200],
	[5500, 10700, 17200],
	[6400, 13200, 22000]
];
const DIFFICULTIES = ['Low', 'Moderate', 'High'];

/** The SRD's words the summary rests on, which a test finds in the pinned source. */
export const SUMMARY_PHRASES = [
	'Multiply the number in the table by the number of characters in the party to get your XP budget for the encounter.',
	'deduct its XP from your XP budget to determine how many XP you have left to spend',
	'If your encounter includes more than two creatures per character, include fragile creatures that can be defeated quickly.',
	'die rolls and other factors can result in an encounter being easier or harder than intended',
	...XP_BUDGET.map((row, i) => `${i + 1} ${row.map((n) => n.toLocaleString('en-US')).join(' ')}`)
];

/** How hard a fight looks by the SRD's guidance, for a party of these levels. */
export function encounterSummary(
	monsters: readonly MonsterListing[],
	levels: readonly number[]
): EncounterSummary {
	const counts = new Map<string, { name: string; count: number; xp: number }>();
	for (const m of monsters) {
		const had = counts.get(m.kind);
		counts.set(m.kind, { name: m.name, count: (had?.count ?? 0) + 1, xp: m.xp });
	}
	const xp = monsters.reduce((n, m) => n + m.xp, 0);
	const budgets = DIFFICULTIES.map((name, i) => ({
		name,
		xp: levels.reduce((n, l) => n + XP_BUDGET[Math.min(20, Math.max(1, l)) - 1][i], 0)
	}));
	const band = !levels.length
		? 'No party'
		: xp < budgets[0].xp
			? 'Below Low'
			: xp <= budgets[0].xp
				? 'Low'
				: xp <= budgets[1].xp
					? 'Moderate'
					: xp <= budgets[2].xp
						? 'High'
						: 'Beyond High';
	const notes = [
		'By the SRD’s guidance (Gameplay Toolbox, “Combat Encounter Difficulty”): each character’s budget by its level, added up for the party, against the monsters’ XP.',
		'Advisory only: die rolls, the ground, tactics and healing make a fight easier or harder than its numbers, and no score promises balance.'
	];
	if (levels.length && monsters.length > 2 * levels.length)
		notes.push(
			'More than two creatures per character: the SRD warns a lucky streak on their part can deal more damage than expected.'
		);
	if (monsters.some((m) => m.notPlayed.length))
		notes.push(
			'Some of these monsters’ traits and actions aren’t played at the table yet (listed on each), so they may be weaker than their XP says.'
		);
	return {
		monsters: [...counts.values()],
		xp,
		party: { characters: levels.length, levels: [...levels] },
		budgets,
		band,
		notes
	};
}

/** The SRD's monsters as a bestiary, read on first use. */
export function srdBestiary(catalog: () => Catalog): Bestiary {
	let read: Map<string, Monster> | null = null;
	const all = () => {
		if (!read) {
			read = new Map();
			for (const r of catalog().all('monster')) {
				const m = readMonster(r);
				read.set(m.listing.kind, m);
			}
		}
		return read;
	};
	const playable = () => [...all().values()].filter((m) => m.enemy);
	return {
		search(query, limit) {
			const q = query.trim().toLowerCase();
			return playable()
				.filter(
					(m) =>
						!q ||
						m.listing.name.toLowerCase().includes(q) ||
						m.listing.type.toLowerCase().includes(q) ||
						m.listing.challenge === q
				)
				.slice(0, limit)
				.map((m) => m.listing);
		},
		listing: (kind) => all().get(kind)?.listing ?? null,
		enemy: (kind) => all().get(kind)?.enemy ?? null,
		summary(kinds, levels) {
			return encounterSummary(
				kinds.flatMap((k) => all().get(k)?.listing ?? []),
				levels
			);
		}
	};
}
