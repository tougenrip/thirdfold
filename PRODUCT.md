# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

One SvelteKit bundle ships as the web app and, unchanged, inside a Tauri desktop shell and a Capacitor mobile shell. The design language is the web's; the native shells do not adopt per-OS conventions.

## Users

Two audiences, equal in priority, and the product must serve both without splitting into two products:

- **Remote groups led by a GM.** Friends playing online from their own homes, each on their own screen. The Game Master creates the room, sets up or picks the story, and runs the session; players join by an invite link, and anyone can watch as a spectator.
- **Newcomers.** People who have never played a tabletop RPG, possibly including a first-time GM. The built-in adventures, the character introductions and the in-session tutorial carry them from a name field to their first discovery without a rulebook.

Creators, who build adventures and publish them to the library, are a supporting audience served by the builder and the library.

## Product Purpose

thirdfold is a real-time multiplayer 3D virtual tabletop for tabletop role-playing games. A group gathers around one shared 3D table in the browser, and the server keeps everyone's view of it consistent and fair: it rolls the dice, enforces who may move what, and decides what each player can see (fog of war, light and dark, private discoveries).

Success is a group that opens a link, is at the table within a minute, plays a whole story through to an ending, and wants to play again.

## Positioning

All four are true of thirdfold together, and none of Roll20, Foundry or Owlbear Rodeo can claim all of them:

- **A real 3D table.** It should feel like a living miniature tabletop, not a 2D map with a 3D renderer added on: elevation, sight lines over walls and through windows, light that matters, props that move, dice that are thrown.
- **Playable stories.** Complete adventures run by the engine: investigation with private evidence, people who talk and react, turn-based fights with enemy AI, choices and multiple endings. A GM can run one with no prep, and direct it live instead of building it.
- **No install, one link.** Share a link and everyone is at the table in the browser, on desktop or mobile.
- **Build and share.** Anyone can build an adventure without code, publish it to the library under a creator name, and others can play and rate it.

## Operating Context

- A session is a room: one GM, players, spectators. The GM starts a story (or builds a table), players join from the invite link and pick a character, and play is live and synchronous.
- Play is at home, usually evenings, often alongside a voice call the product does not provide.
- Sessions survive network drops and restarts; a GM's saves are theirs by a GM key kept in their browser; a story in play autosaves.
- The adventure builder (`/builder`) and the library (`/library`) are separate surfaces from the table.

## Capabilities and Constraints

- Authoritative game server: clients request, the server validates and broadcasts. The client is never trusted for roles, ownership, positions, dice or visibility.
- The frontend is a static SPA (no server routes); anything secret lives in the game server or behind Supabase.
- Built-in adventures: **The Hollow Bell** (fantasy: a village, a monastery, the Hollow beneath) and **The Last Train to Blackwater** (a supernatural western aboard a night train, Arizona, 1889). The engine is system-agnostic; adventures are data.
- Terminology in use: Game Master (GM), player, spectator, room, table, scene, token, prop, story, chapter, objective, evidence (private until shared), clue, encounter, the library, creator.
- Out of scope unless decided otherwise: voice/video, billing or a marketplace, campaign management, full rules systems.

## Brand Commitments

- **Name:** thirdfold, always lower-case. The name comes from the logo: a book whose revealed page folds out into a map, the page, the drop over the edge and the spread on the table being the three folds.
- **Logo:** `static/brand/` (colour, no-colour and animated marks; wordmark in Alegreya Bold). The no-colour mark is the favicon and app icon; the colour and animated marks are for the front page and the loading screen.
- **Voice (binding):** plain, warm and in-world. The copy speaks like a good GM at the table: it tells people what is happening and what they can do, honestly and briefly ("The first answer stands.", "Keep it secret, like a password.", "Games are invite-only unless their GM lists them."). Never jokey, never gamer slang, never marketing hype.

## Evidence on Hand

- Two complete built-in adventures and a small example adventure (The Miller's Key) in the builder.
- No testimonials, user counts, reviews, press or pricing exist. Do not invent any.

## Product Principles

1. **The table is the product.** Chrome serves the shared 3D table and gets out of its way; nothing important happens only in a side panel.
2. **Fair by construction.** What a player sees, rolls or may do is decided by the server; the interface only offers what the rules allow and explains refusals in plain words.
3. **Learn by playing.** A newcomer is taught inside the real session by doing the thing, one step at a time, never by a manual.
4. **Direct, don't build.** A GM should be able to run a story from start to finish with the Direct panel alone.
5. **One link.** Every flow starts from a link and a name; accounts, installs and setup are friction to remove.

## Accessibility & Inclusion

- Keyboard reachable throughout, with visible focus; the table itself takes focus and moves the selected token with the arrow keys.
- Motion is presentation only and respects reduced motion; sound is synthesized locally with a mute and per-channel levels.
- Newcomers are a primary audience: no jargon without explanation, and every refusal says why.
