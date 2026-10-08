# Rules-System Roadmap: Milestones 41–60

This is the focused implementation guide for milestones 41–60 only. It is written for Claude and contributors who will implement this sequence. The tracker is [#85](https://github.com/tougenrip/thirdfold/issues/85); the matching milestone issue owns the scope and completion criteria. A copy-paste kickoff prompt is in [PROMPT-RP-SYSTEM.md](PROMPT-RP-SYSTEM.md).

## Read before starting implementation

Before changing code for any milestone in this roadmap:

1. Read this whole document.
2. Read the matching GitHub issue and check its current status.
3. Inspect the current implementation named by that issue before editing it.
4. Follow the milestone order below. If a user explicitly asks for a later milestone, identify which earlier prerequisites are complete and stay within the requested scope.
5. Keep game decisions authoritative on the server. The browser may present choices and explain outcomes, but the server validates actions, rolls dice, derives rules values, checks access, and persists state.

## Starting point and target

Milestones 1–40 are complete. Thirdfold already has a server-authoritative WebSocket game server, a shared renderer-free game domain, a data-driven adventure engine, The Hollow Bell and The Last Train to Blackwater, an adventure builder/library, persistence/recovery, and a 3D square-grid table.

Playable characters and combat still use four fixed adventure characters, four custom stats, a small action/status model, and a one-action turn. The target is to add D&D 5.5e as one ruleset without turning shared game concepts into D&D concepts, then prove the same product can run a second rules system.

Preserve existing adventures, content files, published versions, and saves. Keep rules/content data-only; never execute creator-supplied code. Pin saves to exact rules and content versions. Rulesets consume tabletop capabilities such as grid movement, line of sight, elevation, fog, and lighting; those capabilities do not belong to a ruleset.

## Ordered milestone plan

### 41 — Rules Engine Abstraction ([#86](https://github.com/tougenrip/thirdfold/issues/86))

**Problem:** Character and combat behavior is coupled to the existing custom adventure rules.

**Plan:** Define a versioned server-side ruleset contract for character operations, checks, turns, combat resolution, and advancement. Put current rules behind a compatibility adapter before adding D&D. Keep transport, scenes, and story flow outside the ruleset; default older saves safely.

**Complete when:** Both existing adventures still play, save, reconnect, and resume unchanged, and a second test adapter can register without D&D types in shared story code.

### 42 — D&D 5.5e Ruleset ([#87](https://github.com/tougenrip/thirdfold/issues/87))

**Problem:** The custom model cannot resolve D&D checks, proficiency, advantage, or turns.

**Plan:** Add a versioned dnd-5.5e ruleset using milestone 41. Implement ability modifiers, d20 checks/saves/attacks, proficiency, advantage/disadvantage, and action categories. Keep calculations on the server.

**Complete when:** Representative checks, saves, and attacks work in a multiplayer slice; legacy adventures keep their current rules.

### 43 — D&D SRD 5.2.1 Content Import ([#88](https://github.com/tougenrip/thirdfold/issues/88))

**Problem:** There is no structured, auditable D&D catalog.

**Plan:** Deterministically import the official [SRD 5.2.1](https://www.dndbeyond.com/srd) into normalized, versioned records with stable IDs, source locations/hashes, and license metadata. Preserve required attribution in the app and exports. Import only SRD content; exclude D&D Beyond Basic Rules and non-SRD material. See the [official Creator FAQ](https://www.dndbeyond.com/creator-faq).

**Complete when:** Records trace to their exact source/version, attribution is visible, and repeat imports are reproducible and diffable.

### 44 — D&D Character Model ([#89](https://github.com/tougenrip/thirdfold/issues/89))

**Problem:** Existing character data stores custom stats and actions, not D&D choices or derived values.

**Plan:** Model versioned characters with level, abilities, proficiency, species, background, class/features, HP, proficiencies, resources, and chosen options. Bind them to rules/catalog versions, separate ownership from display data, and derive values server-side.

**Complete when:** The server creates, validates, serializes, restores, and recalculates D&D characters without changing legacy characters.

### 45 — D&D Character Creator ([#90](https://github.com/tougenrip/thirdfold/issues/90))

**Problem:** Players can only choose one of four shared pregenerated characters.

**Plan:** Guide players through supported SRD origins, classes, abilities, and starting choices. Validate prerequisites and content access on the server; make unfinished creation recoverable and assign characters through existing room/token permissions.

**Complete when:** A player creates a legal level-1 SRD character and joins a room; invalid or unauthorized choices are rejected.

### 46 — D&D Character Sheet ([#91](https://github.com/tougenrip/thirdfold/issues/91))

**Problem:** The current sheet only explains custom stats and adventure actions.

**Plan:** Show abilities, proficiency, skills/saves, defenses, HP, movement, features, equipment, spells/resources, and conditions as they arrive. Separate derived values, editable choices, and live state; preserve the existing legacy sheet.

**Complete when:** Players and GM see consistent server values, permitted edits survive reconnects, and the layout works on desktop and mobile.

### 47 — D&D Inventory & Equipment ([#92](https://github.com/tougenrip/thirdfold/issues/92))

**Problem:** Scene props and story-carried objects are not character inventory, and equipment has no rules effect.

**Plan:** Add owned inventory with quantities/provenance and supported SRD equip rules for weapons, armor, shields, and ammunition. Derive changed values on the server. Connect dropped items to physical props when suitable without merging the concepts.

**Complete when:** Equipment changes authoritative combat values, inventory persists, and props remain distinct.

### 48 — D&D Spell System ([#93](https://github.com/tougenrip/thirdfold/issues/93))

**Problem:** Existing actions do not model spell catalogs, slots, casting, targeting, saves, duration, or concentration.

**Plan:** Add structured SRD spells, supported known/prepared choices, resources, casting time, range/area, components, attacks/saves, duration, and concentration. Resolve casts server-side and define the effect interface for milestone 49. State unsupported cases instead of approximating them silently.

**Complete when:** Representative attack, save, healing, area, and concentration spells work with persistent, enforced resource use.

### 49 — D&D Conditions & Effects ([#94](https://github.com/tougenrip/thirdfold/issues/94))

**Problem:** Three custom statuses cannot represent timed, sourced, stacking D&D effects.

**Plan:** Model effect source/target, duration, expiry point, and behavior. Apply, refresh, stack, suppress, and remove effects on the server. Define turn/round and concentration timing; keep legacy adventure statuses separate.

**Complete when:** Effects survive save/load and reconnect, cannot be forged by clients, and can be used by spells and monsters.

### 50 — D&D Combat Integration ([#95](https://github.com/tougenrip/thirdfold/issues/95))

**Problem:** The current encounter loop assumes one movement and one custom action per turn.

**Plan:** Integrate D&D initiative, supported grid scale, actions/bonus actions/reactions, attacks, saves, damage, healing, death saves, resources, and round timing. Resolve range, sight, cover, conditions, resistance, and equipment via the ruleset; explain results to players.

**Complete when:** A multiplayer encounter runs from initiative to victory/defeat, persists correctly, and leaves legacy combat intact.

### 51 — D&D Monsters & Encounter System ([#96](https://github.com/tougenrip/thirdfold/issues/96))

**Problem:** Existing enemies and AI are adventure-specific.

**Plan:** Normalize SRD monsters with provenance. Let GMs assemble encounters, place monsters, and inspect an advisory difficulty/XP summary with stated assumptions. Provide predictable server-side behavior and GM control.

**Complete when:** SRD monsters take legal turns in a saved/restored multiplayer encounter without changing existing enemies.

### 52 — D&D Homebrew Engine ([#97](https://github.com/tougenrip/thirdfold/issues/97))

**Problem:** The builder authors stories, but cannot define D&D-compatible options, items, spells, or monsters.

**Plan:** Add versioned, typed homebrew packs that extend but do not mutate SRD records. Bound supported content kinds, validate IDs/references/prerequisites/ownership/ruleset, and reject scripts or executable formulas. Keep drafts private until shared.

**Complete when:** A small homebrew set can be used in a character or adventure and SRD provenance remains intact.

### 53 — Campaign Content Collections ([#98](https://github.com/tougenrip/thirdfold/issues/98))

**Problem:** The library publishes one adventure at a time, but a campaign needs a compatible bundle of adventures, scenes, and rules/content packs.

**Plan:** Add manifests that reference content, declare ruleset compatibility, identify creators, and report missing dependencies. Reuse the library and ownership model. Complete immutable dependency pinning in milestone 55.

**Complete when:** A GM starts a collection with its declared content and can resolve the same set from a save.

### 54 — Content Permissions & Entitlements ([#99](https://github.com/tougenrip/thirdfold/issues/99))

**Problem:** Public/unlisted library controls do not cover private, shared, campaign-granted, or licensed content.

**Plan:** Define server-side permissions and scoped grants with provenance/revocation across list/read/use/export/publish/remove. Extend GM-key identity without assuming accounts, billing, or a marketplace.

**Complete when:** Guessed IDs or forged requests cannot expose restricted content, while existing library and SRD access remain correct.

### 55 — Content Versioning ([#100](https://github.com/tougenrip/thirdfold/issues/100))

**Problem:** Adventure snapshots exist, but rulesets and content dependencies are not a fully pinned immutable graph.

**Plan:** Version rulesets, catalogs, homebrew packs, collections, and adventures. Pin versions in characters, stories, and campaigns. Define compatibility, explicit upgrades, migrations, rollback, and historical reads while preserving existing library behavior.

**Complete when:** Publisher updates cannot change active saves; old saves load or have a clear validated migration path.

### 56 — Rules/Data Validation ([#101](https://github.com/tougenrip/thirdfold/issues/101))

**Problem:** Current validation does not unify D&D records, permissions, collection dependencies, and version compatibility with adventure checks.

**Plan:** Provide stable error codes and precise paths. Validate schemas, references, prerequisites, formulas, source/license metadata, entitlements, dependencies, and ruleset compatibility in authoring and again on the server at import, publish, load, and session start. Never silently drop unknown fields.

**Complete when:** Invalid data is stopped before play and creators receive actionable diagnostics through a shared validator.

### 57 — D&D Adventure Authoring ([#102](https://github.com/tougenrip/thirdfold/issues/102))

**Problem:** The builder does not guide creators through D&D checks, rests, rewards, spells, and encounter dependencies.

**Plan:** Add a D&D template and rule-aware authoring for checks/saves, encounters, rewards, rests, and collection dependencies. Reuse data-only files, milestone 56 diagnostics, and pinned rules/content versions; keep generic story flow usable by other systems.

**Complete when:** A creator builds, validates, previews, saves, and publishes a short SRD-based adventure without application code, with server revalidation before play.

### 58 — D&D Campaign System ([#103](https://github.com/tougenrip/thirdfold/issues/103))

**Problem:** Rooms recover sessions, but do not carry a party, progression, and history across adventures.

**Plan:** Add campaign ownership, roster, active session/adventure, history/state, and rules/content pins. Carry authorized characters and supported progression between adventures through collections, permissions, and versioning.

**Complete when:** A group finishes one D&D adventure, returns with validated party progress, and starts the next.

### 59 — External Content / Licensed Content Architecture ([#104](https://github.com/tougenrip/thirdfold/issues/104))

**Problem:** Publisher catalogs can have different attribution, access, export, update, and revocation terms.

**Plan:** Define source adapters/manifests for local/imported/partner content with license, permitted uses, attribution, entitlement, version, and provenance. Separate mechanics from restricted text/art/trademarks; enforce terms at list/read/use/export/cache boundaries. Do not ingest commercial catalogs without explicit rights and an approved source.

**Complete when:** A hypothetical licensed pack fits documented interfaces with its terms enforced and remains distinguishable from SRD/homebrew.

### 60 — Second Rules System ([#105](https://github.com/tougenrip/thirdfold/issues/105))

**Problem:** D&D alone cannot prove the abstraction is multi-system; its assumptions may have leaked into shared models and saves.

**Plan:** Select a meaningfully different rules system using milestone 59's source/access gates and record a mechanics comparison before implementation. Build a minimal playable adapter and validated content set through shared character, encounter, save, and authoring paths. Do not preselect a proprietary catalog or copy protected text/art.

**Complete when:** A GM runs a small multiplayer adventure under either ruleset; saves remain ruleset-bound, and shared models have no D&D-only fields.

## Cross-milestone checkpoints

- After 41–43: both old adventures still work and a D&D session resolves basic checks from traceable SRD data.
- After 44–51: a player creates a D&D character and completes an encounter with equipment, spells, conditions, and monsters.
- After 52–57: creators can extend, bundle, permission, version, validate, and author content without executable code.
- After 58–60: persistent campaigns work and a second rules system uses the shared multiplayer product.
- At every boundary, keep compatibility, permissions, provenance, and save migration explicit; do not defer them to UI-only work.
