# System Reference Document 5.2.1

This work includes material from the System Reference Document 5.2.1 (“SRD 5.2.1”) by Wizards of the Coast LLC, available at https://www.dndbeyond.com/srd. The SRD 5.2.1 is licensed under the Creative Commons Attribution 4.0 International License, available at https://creativecommons.org/licenses/by/4.0/legalcode.

## What is here

- `SRD_CC_v5.2.1.pdf`: the official SRD 5.2.1, exactly as Wizards of the Coast publishes it (SHA-256 `8974902d109d6e63672d7c490bde9ccf052410503d9cfa768237154fbc5e3d87`). The importer refuses any other file.
- `catalog/`: the records thirdfold imports from it, one JSON file per kind (rules terms, species, backgrounds, feats, classes, subclasses, weapons, armor, spells, monsters), plus:
  - `manifest.json`: the source (title, version, publisher, file, hash, licence, attribution), the importer's version, each file's record count and hash, and the SRD chapters not imported as records;
  - `diagnostics.json`: every place the importer corrected the source's text (a heading's scrambled letter case, a "Component:" label, a save printed without its sign), each with its page.

Every record has an id stable across imports (`srd-5.2.1:<kind>:<name>`) and its provenance: the source, the section it is in (the PDF's own outline) and the pages it spans.

Only the SRD is imported: nothing from the D&D Beyond Basic Rules or any other book.

## Using it

The server reads the catalog at run time with `srdCatalog()` (`server/rules/dnd55e/catalog.ts`), which checks each file against the manifest's hash before using it. Fifth edition characters (`server/rules/dnd55e/character/`) name its records by id and are pinned to its source and version.

## Importing

The catalog is generated, never edited by hand:

```bash
npm run srd         # import the PDF and write catalog/
npm run srd:check   # fail if catalog/ isn't what the PDF imports to
```

The same PDF always imports to the same bytes, so a change to the importer shows up as a diff of `catalog/` to review. The test `server/rules/dnd55e/srd/srd.spec.ts` fails when the committed catalog is out of date.
