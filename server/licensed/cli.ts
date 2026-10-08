// The operator's tool for licensed sources (milestone 59, docs/LICENSED.md):
//
//   npm run licensed -- list                         installed sources, their status and grants
//   npm run licensed -- check                        reads every installed source and its content
//   npm run licensed -- grant <source> <creator id> [--days N] [--by NAME] [--note TEXT]
//   npm run licensed -- revoke <grant id>
//   npm run licensed -- withdraw <source> [--note TEXT]
//   npm run licensed -- restore <source> [--note TEXT]
//
// Sources come from LICENSED_DIR (default content/licensed); grants and
// statuses go to Supabase when SUPABASE_URL and SUPABASE_SERVICE_KEY are
// set (as server/index.ts decides), else to LICENCES_DIR (default
// data/licences). A running game server reads them on each check, so a
// revocation or withdrawal holds from the next start, load or attach.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import '../rules';
import { describeTerms } from '../../src/lib/content/licence';
import { findRuleset } from '../rules/ruleset';
import {
	FileLicenceStore,
	licenceActive,
	SupabaseLicenceStore,
	type LicenceStore
} from './licence-store';
import { installedSource, installedSources, installSources } from './sources';

export function licenceStoreFromEnv(env = process.env): { store: LicenceStore; where: string } {
	const { SUPABASE_URL: url, SUPABASE_SERVICE_KEY: key } = env;
	if (url && key) return { store: SupabaseLicenceStore.connect(url, key), where: 'Supabase' };
	if (url || key) throw new Error('Set both SUPABASE_URL and SUPABASE_SERVICE_KEY, or neither.');
	const dir = path.resolve(env.LICENCES_DIR ?? 'data/licences');
	return { store: new FileLicenceStore(dir), where: dir };
}

function option(args: string[], name: string): string | undefined {
	const i = args.indexOf(`--${name}`);
	return i >= 0 ? args[i + 1] : undefined;
}

export async function run(args: string[], env = process.env, log = console.log): Promise<number> {
	const dir = path.resolve(env.LICENSED_DIR ?? 'content/licensed');
	const { installed, skipped } = installSources(dir);
	const [command, ...rest] = args;
	const { store, where } = licenceStoreFromEnv(env);
	switch (command) {
		case 'list': {
			log(`Licensed sources in ${dir}; grants in ${where}.`);
			for (const s of installedSources()) {
				const status = (await store.status(s.file.id))?.status ?? 'active';
				log(`\n${s.file.id}: ${s.file.name} ${s.file.version}, by ${s.file.publisher} (${status})`);
				if (s.file.provenance.hypothetical) log('  hypothetical: made up for tests and docs');
				for (const line of describeTerms(s.file.terms)) log(`  ${line}`);
				for (const g of await store.grants(s.file.id))
					log(
						`  grant ${g.id} to ${g.creator} by ${g.by}, ${
							licenceActive(g) ? (g.expires ? `until ${g.expires}` : 'in force') : 'not in force'
						}${g.note ? `: ${g.note}` : ''}`
					);
			}
			for (const s of skipped) log(`skipped ${s}`);
			return 0;
		}
		case 'check': {
			let failed = skipped.length;
			for (const s of skipped) log(`✗ ${s}`);
			for (const id of installed) {
				const source = installedSource(id)!;
				const packs = findRuleset(source.file.rules)?.packs;
				const held = packs?.holdLicensed?.({ file: source.file, content: source.content });
				if (held?.ok) log(`✓ ${id}: ${held.id}`);
				else {
					failed++;
					log(
						`✗ ${id}: ${held ? held.problems.join('; ') : `no rules ${source.file.rules.id} v${source.file.rules.version} take licensed content here`}`
					);
				}
			}
			return failed ? 1 : 0;
		}
		case 'grant': {
			const [source, creator] = rest;
			if (!source || !installedSource(source)) {
				log(`No installed source "${source ?? ''}".`);
				return 1;
			}
			const days = option(rest, 'days');
			const grant = await store.grant(source, creator ?? '', {
				by: option(rest, 'by') ?? 'operator',
				...(days ? { days: Number(days) } : {}),
				...(option(rest, 'note') ? { note: option(rest, 'note') } : {})
			});
			log(
				`Granted ${source} to ${grant.creator}: grant ${grant.id}${grant.expires ? `, until ${grant.expires}` : ''}.`
			);
			return 0;
		}
		case 'revoke': {
			const ok = await store.revoke(rest[0] ?? '');
			log(ok ? `Revoked ${rest[0]}.` : `No grant in force with id "${rest[0] ?? ''}".`);
			return ok ? 0 : 1;
		}
		case 'withdraw':
		case 'restore': {
			const source = rest[0];
			if (!source || !installedSource(source)) {
				log(`No installed source "${source ?? ''}".`);
				return 1;
			}
			await store.setStatus(
				source,
				command === 'withdraw' ? 'withdrawn' : 'active',
				option(rest, 'note') ?? ''
			);
			const terms = installedSource(source)!.file.terms;
			log(
				command === 'withdraw'
					? `Withdrew ${source}: ${terms.withdrawal === 'stop' ? 'every story using it stops' : 'stories under way may finish; no new story takes it up'}.`
					: `Restored ${source}.`
			);
			return 0;
		}
		default:
			log(
				'Commands: list, check, grant <source> <creator id>, revoke <grant id>, withdraw <source>, restore <source>.'
			);
			return command ? 1 : 0;
	}
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
	run(process.argv.slice(2)).then(
		(code) => process.exit(code),
		(err) => {
			console.error((err as Error).message);
			process.exit(1);
		}
	);
}
