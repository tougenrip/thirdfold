---
name: thirdfold
description: A living 3D miniature tabletop in the browser; walnut and brass chrome around the table, vellum for the story.
colors:
  walnut-bg: '#14100d'
  walnut-panel: 'rgba(30, 24, 19, 0.8)'
  walnut-panel-solid: '#1c1612'
  walnut-panel-raised: '#251d17'
  walnut-panel-sunk: '#120e0b'
  scrim: 'rgba(10, 8, 6, 0.6)'
  edge: 'rgba(255, 236, 210, 0.09)'
  edge-strong: 'rgba(255, 236, 210, 0.38)'
  edge-hover: 'rgba(255, 236, 210, 0.55)'
  fill: 'rgba(255, 238, 214, 0.07)'
  fill-hover: 'rgba(255, 238, 214, 0.12)'
  fill-active: 'rgba(255, 238, 214, 0.16)'
  candle-text: '#f2e6d0'
  ash-muted: '#b3a38a'
  brass: '#e0a458'
  brass-hover: '#ebb46e'
  brass-deep: '#c98b3f'
  brass-ink: '#1a120a'
  brass-wash: 'rgba(224, 164, 88, 0.14)'
  vellum: '#eadcbf'
  vellum-edge: '#c9b48e'
  ink: '#2a1d12'
  ink-muted: '#5e4a35'
  ink-red: '#8a3b3b'
  ok: '#7fc47a'
  danger: '#e27a6b'
  blood: '#c0392b'
  fire: '#ff9a4d'
  glow: '#9fd7ff'
typography:
  display:
    fontFamily: "Alegreya, Georgia, 'Times New Roman', serif"
    fontSize: '3.4rem'
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: '0.02em'
  headline:
    fontFamily: "Alegreya, Georgia, 'Times New Roman', serif"
    fontSize: '1.6rem'
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: '-0.01em'
  title:
    fontFamily: "Alegreya, Georgia, 'Times New Roman', serif"
    fontSize: '1.25rem'
    fontWeight: 700
    lineHeight: 1.15
  story:
    fontFamily: "Alegreya, Georgia, 'Times New Roman', serif"
    fontSize: '1rem'
    fontWeight: 500
    lineHeight: 1.5
  body:
    fontFamily: "'Alegreya Sans', system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: '1rem'
    fontWeight: 400
    lineHeight: 1.45
    fontFeature: 'lnum'
  label:
    fontFamily: "'Alegreya Sans', system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: '0.9rem'
    fontWeight: 500
    lineHeight: 1.2
  section-title:
    fontFamily: "Alegreya, Georgia, 'Times New Roman', serif"
    fontSize: '0.9rem'
    fontWeight: 700
    letterSpacing: '0.04em'
    fontFeature: 'smcp'
  mono:
    fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace"
    fontSize: '0.9rem'
    fontWeight: 400
rounded:
  sm: '8px'
  md: '16px'
  lg: '24px'
  field: '14px'
  control: '999px'
  pill: '999px'
spacing:
  sp-1: '0.125rem'
  sp-2: '0.25rem'
  sp-3: '0.375rem'
  sp-4: '0.5rem'
  sp-5: '0.75rem'
  sp-6: '1rem'
  sp-7: '1.5rem'
  sp-8: '2rem'
components:
  button:
    backgroundColor: '{colors.fill}'
    textColor: '{colors.candle-text}'
    typography: '{typography.label}'
    rounded: '{rounded.control}'
    padding: '0.45rem 1.1rem'
    height: '2.25rem'
  button-hover:
    backgroundColor: '{colors.fill-hover}'
  button-active:
    backgroundColor: '{colors.fill-active}'
  button-primary:
    backgroundColor: '{colors.brass}'
    textColor: '{colors.brass-ink}'
    rounded: '{rounded.control}'
    padding: '0.45rem 1.1rem'
    height: '2.25rem'
  button-primary-hover:
    backgroundColor: '{colors.brass-hover}'
  button-primary-active:
    backgroundColor: '{colors.brass-deep}'
  button-ghost:
    backgroundColor: 'transparent'
    textColor: '{colors.ash-muted}'
    rounded: '{rounded.control}'
  button-ghost-hover:
    backgroundColor: '{colors.fill}'
    textColor: '{colors.candle-text}'
  button-selected:
    backgroundColor: '{colors.brass-wash}'
    textColor: '{colors.brass}'
  button-danger:
    backgroundColor: 'rgba(226, 122, 107, 0.12)'
    textColor: '{colors.danger}'
    rounded: '{rounded.control}'
  input:
    backgroundColor: 'rgba(0, 0, 0, 0.28)'
    textColor: '{colors.candle-text}'
    rounded: '{rounded.field}'
    padding: '0.55rem 0.7rem'
    height: '2.5rem'
  panel:
    backgroundColor: '{colors.walnut-panel}'
    textColor: '{colors.candle-text}'
    rounded: '{rounded.md}'
    padding: '{spacing.sp-5}'
  room-bar:
    backgroundColor: '{colors.walnut-panel}'
    rounded: '{rounded.pill}'
    padding: '0.5rem 0.75rem'
  vellum-card:
    backgroundColor: '{colors.vellum}'
    textColor: '{colors.ink}'
    rounded: '{rounded.lg}'
    padding: '{spacing.sp-7}'
  vellum-button-primary:
    backgroundColor: '{colors.ink}'
    textColor: '{colors.vellum}'
    rounded: '{rounded.control}'
  hud-chip:
    backgroundColor: '{colors.walnut-panel-solid}'
    textColor: '{colors.candle-text}'
    rounded: '{rounded.pill}'
    padding: '0.375rem 1rem'
---

# Design System: thirdfold

## Overview

**Creative North Star: "The Walnut Table and Its Vellum"**

thirdfold's chrome is the furniture around a lamp-lit tabletop: dark walnut panels frosted over the 3D table, brass for the one thing to do next, and sheets of vellum let down over the table when the story itself speaks (a choice, a welcome, an ending). Everything a group operates is set in Alegreya Sans; everything the story says is set in Alegreya. The table is the product, so chrome is translucent, docked to the edges, and never covers the free middle of the table except for story cards and transient HUD chips.

Two skins share one world. **Modern** (active) is `src/skin-modern.css`, layered over `src/app.css`: flat filled pill controls, softly rounded fields, light-on-dark edges instead of brown rules, and a brass focus halo. **Classic** is `src/app.css` alone: bevelled wooden keys with brass-gradient primaries, hairline brown borders, 4/8/12px corners and dashed-outline disabled states. The skin's tokens are set on `:root:not([data-skin="classic"])` so they outweigh app.css's `:root`; its element rules wrap only the skin switch in `:where()` so they weigh exactly what they replace. To compare in place set `data-skin="classic"` on `<html>`; to revert for good delete the `skin-modern.css` import in `src/routes/+layout.svelte`. All tokens below are the modern values; where classic differs, the sidecar notes it.

Motion is physical and folded, after the logo (a book whose page folds out into a map): the front page's board unfolds on load and folds shut into the room via view transitions, story cards unroll from their top edge, the current turn chip catches a glint of light. All of it drops out under `prefers-reduced-motion`.

**Key Characteristics:**

- Dark, warm, candle-lit; one brass accent; vellum reserved for the story's voice.
- Translucent walnut panels with 6px backdrop blur, docked to the table's edges.
- Pill controls, 14px fields, 8/16/24px surfaces.
- Serif for story and headings, humanist sans for operation, mono only for codes and dice expressions.
- Folding and unrolling motion, all presentation, all removable.

## Colors

A warm near-black walnut ground, cream text, one brass accent, a parchment second world, and a small set of state colours borrowed from the table's own lights.

### Primary

- **Lamp Brass** (#e0a458): the primary action's fill, the selected state's text, links, focus outlines, the caret, the current turn and GM role marks. Hover lifts to **Polished Brass** (#ebb46e), press sinks to **Worn Brass** (#c98b3f). Text on brass is **Brass Ink** (#1a120a). **Brass Wash** (14% brass) fills selected toggles and the welcome's goal box.

### Secondary

- **Vellum** (#eadcbf) with **Vellum Edge** (#c9b48e): the story's cards only. On vellum the palette inverts: **Iron-Gall Ink** (#2a1d12) for text and the primary button's fill, **Faded Ink** (#5e4a35) for muted text, **Rubric Red** (#8a3b3b) replaces brass as accent and focus colour.

### Tertiary (state and table light)

- **Hearth Green** (#7fc47a): connected, healing, online dots.
- **Ember Red** (#e27a6b): danger buttons, errors, fights (encounter strip, enemy turns, foe HP), reconnect banners.
- **Blood** (#c0392b), **Fire** (#ff9a4d), **Bell Glow** (#9fd7ff): damage, burning and the Bell's light on the table; not chrome colours.

### Neutral

- **Walnut Ground** (#14100d): the page and room background.
- **Walnut Panel** (80% walnut) for frosted panels and the room bar; **Solid** (#1c1612) for opaque HUD cards, toasts and banners; **Raised** (#251d17); **Sunk** (#120e0b) for wells and HP tracks.
- **Candle Cream** (#f2e6d0): body text. **Ash** (#b3a38a): muted text, placeholders, section titles.
- **Light Edge** (9% cream): panel edges and hairline dividers. **Strong Edge** (38% cream, 3.25:1 on every walnut surface) and **Edge Hover** (55%): field and control edges, which must read at 3:1. **Fill / Fill Hover / Fill Active** (7/12/16% cream): button surfaces.
- **Scrim** (60% near-black): behind modal story cards.

### Named Rules

**The One Brass Rule.** Brass marks the single next action, the selected state and focus. A screen has at most one brass-filled button in view per decision.

**The Two Worlds Rule.** Walnut is for what the group operates; vellum is for what the story says. Operational controls never go on vellum except the card's own answers, and story text never sits on a plain walnut panel as a card.

## Typography

**Display Font:** Alegreya (with Georgia, Times New Roman), self-hosted weights 500, 500 italic, 700
**Body Font:** Alegreya Sans (with system-ui), self-hosted weights 400, 400 italic, 500, 700
**Label/Mono Font:** ui-monospace, for room codes and dice expressions only

**Character:** A calligraphic book face for the story and a humanist sans from the same family for the controls, so the story and the tools sound related without sounding alike.

### Hierarchy

- **Display** (700, 3.4rem, +0.02em): the front page wordmark beside the logo mark, and the big number on the roll card.
- **Headline** (700, 1.6rem, 1.15): vellum card titles (Decision, Welcome, Continue).
- **Title** (700, 1.25rem): sub-headings, front page links to the library and builder.
- **Story** (Alegreya 500, 1rem, 1.5, max 65ch): narration and card prose.
- **Body** (Alegreya Sans 400, 1rem, 1.45, lining numerals): everything operational.
- **Label** (500, 0.9rem / 0.8rem / 0.72rem): button text, hints, meta lines, kbd.
- **Section Title** (Alegreya 700, 0.9rem, small caps, +0.04em, ash): the heading of a panel section.

Headings use `text-wrap: balance`; numbers that change in place (HP, initiative, counters) are tabular.

### Named Rules

**The Small Caps Rule.** A panel section is named in the story's face in small caps, never with an uppercase tracked sans label.

**The 1.25 Step Rule.** Sizes come from the scale (0.72, 0.8, 0.9, 1, 1.25, 1.6, 2.4, 3.4rem); dense for panels, generous for the story.

## Layout

**The room** is a full-viewport 3D table with chrome pinned to its edges at a 0.75rem inset: a one-line top bar (brand, room code, players, views, connection status; pill-shaped, a 24px card when it wraps), a side column of foldable `<details>` panels on the right (17rem, 19rem at ≥80rem), and the chat docked bottom-left (21rem, 17rem at ≤64rem; height min(24rem, 42vh)). The space between them is the free table; HUD stacks sit in it, centred: `.hud-top` under the bar (pause, hints, encounter strip, banners) and `.hud-bottom` above the table's bottom edge (the action bar). Story cards centre in the free table below the bar.

**Below 48rem** the table fills the screen: the bar tightens and wraps, a three-tab dock (2.75rem touch targets) sits at the bottom, and one panel at a time slides up over the table as a bottom sheet (max 70vh).

**The front page** is a centred 72rem board, vertically centred on tall screens: a crest (wordmark and tagline), then a two-column grid (1.65fr play / 1fr aside) from 60rem, divided by a hairline in the gutter; one column below.

Spacing uses the `sp-` scale (0.125 to 2rem); panel padding is 0.75rem, card padding 1 to 1.5rem, gaps 0.25 to 1rem. Layers: HUD 2, panels 3, story overlays 5, modals 6, toasts 7.

## Elevation & Depth

Hybrid: panels over the table are translucent and frosted (6px backdrop blur) with a light edge rather than a shadow; floating cards (roll card, vellum) are lifted with a two-part shadow, a tight contact shadow plus a long soft fall. Shadows are always offset and blurred, never hard.

### Shadow Vocabulary

- **Contact** (`box-shadow: 0 1px 2px rgba(0,0,0,0.3), 0 2px 8px rgba(0,0,0,0.2)`): small lifted elements.
- **Float** (`box-shadow: 0 1px 2px rgba(0,0,0,0.3), 0 12px 32px rgba(0,0,0,0.38)`): the roll card and floating HUD cards.
- **Overlay** (`box-shadow: 0 2px 4px rgba(0,0,0,0.3), 0 24px 64px rgba(0,0,0,0.5)`): vellum story cards, combined with an inner parchment glow.
- **Brass Halo** (`box-shadow: 0 0 0 3px rgba(224,164,88,0.35)`): focus, alongside a 2px brass outline.

### Named Rules

**The Frosted Chrome Rule.** Chrome over the table is translucent walnut with blur, so the table reads through it; only transient cards are opaque.

## Shapes

Soft and round. Buttons are full pills (999px); fields are 14px (a pill textarea would be absurd); surfaces step 8px (tags, kbd), 16px (panels, toasts, banners), 24px (story cards, roll card, dock tabs, wrapped bar). Status chips, the encounter strip, pause and hint lines are pills. Borders are 1px; a coloured 1px border all round (brass or ember) marks a card's kind. Circles are for presence dots only.

## Components

### Buttons

Flat, filled, one height.

- **Shape:** pill (999px), min height 2.25rem, padding 0.45rem 1.1rem, weight 500.
- **Default:** 7% cream fill, no border; hover 12%, press 16% with a 0.98 scale.
- **Primary:** brass fill, brass-ink text, weight 700, a faint top highlight; hover polished brass, press worn brass.
- **Ghost:** transparent, ash text; hover takes the default fill and cream text.
- **Selected** (`aria-pressed` / `aria-checked`): brass wash with a 45% brass edge and brass text.
- **Danger:** 12% ember wash with ember text; 20% on hover.
- **Disabled:** same shape, 45% opacity.
- **Focus:** 2px brass outline at 1px offset plus the brass halo.

### Inputs / Fields

- **Style:** sunk (28% black), strong 1px edge (3:1), 14px radius, min height 2.5rem; hover brightens the edge to 55%.
- **Focus:** brass border, the halo, darker well (36% black), no outline.
- **Disabled:** 50% opacity. Checkboxes and radios use brass `accent-color`.

### Panels

Frosted walnut, light edge, 16px corners, 0.75rem padding. In the room they are `<details>` folds: a ▸ that turns 90°, the panel's name in the summary, the current value in brass at the right; content opens with a height transition.

### Navigation (room bar)

One pill across the top holding groups divided by hairlines: bold brand link, mono room code tracked 0.15em, player list with presence dots and GM tag in brass, view switches, and a connection status whose dot fills when connected (green) and hollows when reconnecting (ember). On mobile it wraps into a 24px card and the panels move to the tab dock.

### HUD chips and banners

Opaque solid-walnut pills and cards in the free table: the encounter strip (ember edge, initiative chips, the current turn in brass with a glint), pause (brass edge), hints (muted), toasts and banners (ember edge; reconnecting in brass), and the roll card (brass edge, the result at display size in brass, green for healing, muted for a miss).

### Vellum story card (signature)

The story's own card: parchment with a top radial highlight and an inner sepia glow, 24px corners, overlay shadow, unrolling from its top edge over 560ms. Inside, tokens re-map locally (muted to faded ink, accent to rubric red), headings are Alegreya in ink, answers are faint ink-tinted pills, and the primary is a solid ink pill with vellum text. Used by Decision, Welcome and the session end screen.

### Book cover (library)

An adventure on the library's shelf is a leather-bound book (`src/lib/ui/StoryCover.svelte`): a 3:4 cover in one of six bindery leathers (oxblood `#5b2a1f`, forest `#2f3d2a`, navy `#243449`, tan `#51341c`, plum `#3b2340`, teal `#1f3a3a`) chosen from the adventure's id so a story always keeps its colour; a spine shadow on the left (black 45% falling off over 9%), a soft sheen top right, a gilt frame tooled 1px inside (brass at 45%), the title set in Alegreya 700 in gilt `#f0d49e`, and the no-colour mark pressed below it at 55%. Covers are decoration (`aria-hidden`): the title always repeats in text beside them. On the shelf a book lifts 4px on hover, and its Run it key turns brass only while it's reached for, so brass marks one choice at a time.

### Brand mark

An isometric book whose page folds out into a map (`static/brand/`): a colour mark in vellum, brass and ink; a mono `currentColor` mark; an animated SMIL mark for loading. The favicon is the mono mark in ink (#2a1d12) on light schemes and cream (#f2e6d0) on dark. The wordmark is "thirdfold", lower-case, in Alegreya Bold. The app icon puts the cream mark on solid walnut.

## Do's and Don'ts

### Do:

- **Do** use one brass primary per decision, and ghost or default pills for everything else.
- **Do** put the story's words (choices, welcomes, endings) on vellum in Alegreya, and the tools on walnut in Alegreya Sans.
- **Do** keep chrome at the table's edges (0.75rem inset) and leave the free table clear; new floating status goes in `.hud-top` or `.hud-bottom`.
- **Do** name panel sections with the small-caps section title.
- **Do** take every value from the tokens (`--sp-*`, `--fs-*`, `--radius-*`, `--shadow-*`, `--z-*`, `--dur`, `--ease-out`) so both skins keep working.
- **Do** give every animation a reduced-motion fallback that keeps the information (the undo clock fades instead of draining).

### Don't:

- **Don't** add a second accent hue to chrome; ember and green are states, fire, blood and glow belong to the table.
- **Don't** use hard offset shadows, bevels or gradients in the modern skin; depth is blur, translucency and soft two-part shadows.
- **Don't** mark a panel or card with a thick coloured side stripe; a kind is shown by a 1px edge all round.
- **Don't** write skin overrides outside `:where(:root:not([data-skin='classic']))`, or the classic fallback breaks.
- **Don't** capitalise "thirdfold" or set the wordmark in anything but Alegreya Bold.
