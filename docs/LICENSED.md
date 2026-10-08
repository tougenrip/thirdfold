# Licensed content

Milestone 59 lets a server use a publisher's catalog on the terms the publisher gave. A licensed source is a third kind of content beside the open SRD (CC-BY-4.0) and a creator's homebrew, and is told apart from them everywhere:

| Kind     | Where it comes from                                  | Ids                    | Who may use it                                       |
| -------- | ---------------------------------------------------- | ---------------------- | ---------------------------------------------------- |
| SRD      | the pinned SRD 5.2.1 catalog (`content/srd/`)        | `srd-5.2.1:…`, `srd-…` | everyone, crediting it                               |
| Homebrew | a pack a GM adds to a story, or one from the library | `hb-…`                 | the story it was added to (and library grants)       |
| Licensed | a source the server's **operator** installed         | `lc-…`                 | as its terms say: every GM, or only those granted it |

Nothing here brings a real publisher's catalog. **Never install a commercial catalog without explicit rights and an approved source.** The only source in the repository is hypothetical: Example Press's _Clockwork Arsenal_ in `content/licensed-example/`, made up to show and test the interfaces.

## A source on disk

The operator puts each source in its own folder of `LICENSED_DIR` (default `content/licensed`), named for its id:

```
content/licensed/clockwork-arsenal/
  source.json     the source file: who, what, its terms, its credit, where it came from
  content.json    its content, pinned by its SHA-256
```

`source.json` (`thirdfold-licensed-source`, format version 1; `LicensedSourceFile` in `src/lib/content/licence.ts`) is read field by field (`readSourceFile` in `server/licensed/sources.ts`). A field the server doesn't know, markup, a newer format or a bad term refuses the source. Its fields:

- `id` (the folder's name), `name`, `publisher`, `version`, `about`.
- `rules`: the rules its content is for, at their exact version (`dnd-5.5e` v1).
- `attribution`: the credit to show wherever it is used, as the publisher wrote it.
- `trademarks`: the publisher's marks. They may appear in the attribution and the source's own name, never in its content: a record whose name or text carries one is refused.
- `terms` (`LicenceTerms`):
  - `licence`: its name and an https address, or null.
  - `entitlement`: `open` (every GM on this server) or `granted` (only GMs the operator granted it to).
  - `uses.export`: whether a story using it may leave the server as a file.
  - `uses.reference`: whether adventures and collections published to the library may name its content.
  - `display`: `full`, or `mechanics` (its records' descriptions and traits' text are never sent: the table gets the mechanics, and "Not shown under its licence.").
  - `withdrawal`: `stop` (when withdrawn, every story using it stops: its saves no longer open) or `finish` (stories under way may go on; nothing new takes it up).
- `provenance`: who supplied it, when, under which agreement, and whether it is `hypothetical`.
- `content`: the content file's name and SHA-256 (line endings read as LF, so a Windows checkout doesn't matter; `.gitattributes` keeps these folders LF).

`content.json` is in the homebrew pack format (`docs/HOMEBREW.md`): weapons, armor, spells with their table mechanics, monsters. It is checked the same way, then read under the source's terms (`readPack` with `LicensedRead`): its ids start `lc-` and hash the source's id and version with the content, so two sources never share an id; the marks are refused; with `display: 'mechanics'` the words are left out.

The game server installs the sources when it starts (`installSources`); a source that doesn't read, or whose content doesn't match its hash, is skipped and named in the log.

## Who may use it

Grants and withdrawals are the operator's, kept by the licence store (`server/licensed/licence-store.ts`): in files (`LICENCES_DIR`, default `data/licences`) or in Supabase (`public.licensed_grants` and `public.licensed_status`, migration `20261008120000_licensed_content.sql`, RLS on and nothing granted to browser roles). A grant names a source and a creator's public id (the one the library's workshop shows, never a GM key), may run out, and is revoked, never deleted. The operator's tool:

```
npm run licensed -- list                         installed sources, their terms, status and grants
npm run licensed -- check                        reads every installed source and its content under its rules
npm run licensed -- grant <source> <creator id> [--days N] [--by NAME] [--note TEXT]
npm run licensed -- revoke <grant id>
npm run licensed -- withdraw <source> [--note TEXT]
npm run licensed -- restore <source> [--note TEXT]
```

`npm run data:backup` takes the licence store too (`data:restore` reads older backups without it).

## Where the terms are enforced

Every check is on the game server (`server/licensed/policy.ts`), from the installed source and the licence store, never from what a client says:

- **List**: `content_sources` (GM) answers only the sources the asking GM may use now: not withdrawn, and open or granted to them.
- **Use**: `adventure_pack` with `op: 'licensed'` and the source's id (GM) attaches it to the story only after the same check (`mayUse`), recording the grant it rests on. A GM can't upload a licensed source: the homebrew upload reads only homebrew, and the server never sends a source's content to a client. A licensed pack is put away like homebrew, when nothing in the story uses it.
- **Read**: a story's view lists a licensed pack with `source: 'licensed'`, its publisher, its credit and its terms; with `display: 'mechanics'` its text was never held. The character creator marks its gear and spells "Licensed: …", the bestiary its monsters "Licensed: …", apart from "Homebrew: …".
- **Save and cache**: a save, an autosave and a live room keep a reference only (`{ source, version, sha256, grant }`), never the content, and carry the source's attribution in `state.credits`. Reading a story back takes the content from the installed source, which must be the same version and hash.
- **Open**: loading, importing or continuing a save, and a story restored after a restart, are refused (`licence.missing`, `licence.withdrawn`, `licence.denied`) when the source isn't installed as it was, was withdrawn under `stop`, or is no longer granted to the GM opening it. A live table whose story fails this after a restart has its story set aside, with a note to the GM; one whose source is no longer installed at all isn't restored (the GM's autosave stays, and says why when opened). A revocation or withdrawal takes effect at the next attach, load, continue or restart: a game in progress is not cut off mid-session.
- **Export**: a story using a source whose terms forbid export is refused (`licence.terms`); saving it on the server still works.
- **Reference**: publishing an adventure, homebrew or collection that names `lc-` content is refused (`licence.terms`) unless the source's terms allow references.
- **Validation**: `content_validate` on a save says the same as a load would (the save validator, version 2).

## Testing it

`server/licensed/*.spec.ts` covers the source file, the hash pin, the content under its terms, the policy and the licence store (memory and files; live Supabase in `server/supabase-scene-store.spec.ts`). The "licensed content over the wire (milestone 59)" block in `server/game-server.spec.ts` runs the hypothetical source from refusal to grant, attach, export refused, a reference-only save, a refused publish, a revocation and a withdrawal. To try it by hand, start the server with `LICENSED_DIR=content/licensed-example` and grant it with `npm run licensed -- grant clockwork-arsenal <your creator id>` (the library's workshop shows your creator id).
