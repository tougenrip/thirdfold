import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ASSETS, resolveAssetId } from '../../src/lib/game/props';
import { catalogModule, loadCatalog, readCatalog, removedIds, staleCatalog } from './catalog';
import { buildAssets } from './pipeline';

// One test builds every asset: a few seconds.
vi.setConfig({ testTimeout: 30_000 });

const crate = { name: 'Crate', category: 'storage', w: 1, h: 1, blocks: 'movement' };
const catalogOf = (props: Record<string, unknown>, aliases: Record<string, unknown> = {}) =>
	readCatalog({ props, aliases });

describe('the prop catalogue', () => {
	it('is generated and committed: src/lib/game/catalog.ts is what assets/catalog.json makes', () => {
		// Run `npm run assets` after changing assets/catalog.json.
		const { catalog, shipped } = loadCatalog('assets');
		expect(staleCatalog('.', 'assets', { catalogModule: catalogModule(catalog), shipped })).toEqual(
			[]
		);
		expect(Object.keys(ASSETS)).toEqual(Object.keys(catalog.props));
	});

	it('refuses a bad entry, naming it', () => {
		expect(() => catalogOf({ crate: { ...crate, category: 'junk' } })).toThrow(
			/\(crate\): category must be one of/
		);
		expect(() => catalogOf({ crate: { ...crate, w: 9 } })).toThrow(/w and h are 1 to 8/);
		expect(() => catalogOf({ crate: { ...crate, name: 'x'.repeat(41) } })).toThrow(/a name/);
		expect(() => catalogOf({ crate: { ...crate, name: "Crate'); alert(1" } })).toThrow(/a name/);
		expect(() => catalogOf({ crate: { ...crate, blocks: 'all' } })).toThrow(/blocks is/);
		expect(() => catalogOf({ crate: { ...crate, jitter: 0.5 } })).toThrow(/jitter/);
		expect(() => catalogOf({ Crate: crate })).toThrow(/bad id/);
		expect(() => catalogOf({ crate: { ...crate, script: 'x' } })).toThrow(/unknown field/);
		expect(catalogOf({ crate: { ...crate, jitter: 0.2 } }).props.crate.jitter).toBe(0.2);
	});

	it('refuses an alias that goes nowhere, hides a prop or points at another alias', () => {
		const props = { crate, barrel: { ...crate, name: 'Barrel' } };
		expect(() => catalogOf(props, { box: 'chest' })).toThrow(/alias box\): no prop "chest"/);
		expect(() => catalogOf(props, { barrel: 'crate' })).toThrow(/is also a prop id/);
		expect(() => catalogOf(props, { box: 'old-box', 'old-box': 'crate' })).toThrow(
			/points at the alias "old-box"/
		);
		expect(catalogOf(props, { box: 'crate' }).aliases).toEqual({ box: 'crate' });
	});

	it('never lets a shipped id disappear: it stays, or becomes an alias', () => {
		const catalog = catalogOf({ crate }, { box: 'crate' });
		expect(removedIds(catalog, ['box', 'crate', 'barrel'])).toEqual(['barrel']);
		expect(removedIds(catalog, ['box', 'crate'])).toEqual([]);
	});

	it('reads an alias as the prop that replaced it, and anything else as nothing', () => {
		const aliases = { 'old-crate': 'crate' } as const;
		expect(resolveAssetId('crate', aliases)).toBe('crate');
		expect(resolveAssetId('old-crate', aliases)).toBe('crate');
		expect(resolveAssetId('old-crate')).toBeNull();
		expect(resolveAssetId('toString', aliases)).toBeNull();
		expect(resolveAssetId('nothing', aliases)).toBeNull();
		expect(resolveAssetId(7, aliases)).toBeNull();
	});
});

describe('the prop catalogue on other sources', () => {
	let dir: string;
	afterEach(() => rmSync(dir, { recursive: true, force: true }));
	const sources = () => {
		dir = mkdtempSync(path.join(tmpdir(), 'thirdfold-catalog-'));
		cpSync('assets', dir, { recursive: true });
		return dir;
	};
	const editCatalog = (src: string, edit: (c: { props: object; aliases: object }) => void) => {
		const file = path.join(src, 'catalog.json');
		const catalog = JSON.parse(readFileSync(file, 'utf8'));
		edit(catalog);
		writeFileSync(file, JSON.stringify(catalog));
	};

	it('takes a new prop from a catalogue entry and a model, with no code change', async () => {
		const src = sources();
		editCatalog(src, (c) =>
			Object.assign(c.props, { stool: { ...crate, name: 'Stool', category: 'furniture' } })
		);
		cpSync(path.join(src, 'models/prop/chair.json'), path.join(src, 'models/prop/stool.json'));
		const built = await buildAssets(src);
		expect(built.manifest.models.stool.kind).toBe('prop');
		expect(built.catalogModule).toContain("stool: { name: 'Stool', category: 'furniture'");
		expect(built.shipped).toContain('stool');
	});

	it('refuses a catalogue that drops a shipped id', () => {
		const src = sources();
		editCatalog(src, (c) => delete (c.props as Record<string, unknown>).well);
		expect(() => loadCatalog(src)).toThrow(/"well" was shipped: keep it, or alias it/);
		editCatalog(src, (c) => Object.assign(c.aliases, { well: 'crate' }));
		expect(loadCatalog(src).shipped).toContain('well');
	});

	it('refuses a catalogue with no provenance', () => {
		const src = sources();
		rmSync(path.join(src, '_provenance.json'));
		expect(() => loadCatalog(src)).toThrow(/catalog\.json: no provenance/);
	});
});
