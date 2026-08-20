# RotationTrainer — Build Plan (WoW patch 12.1.0, Aug 2026)

A browser-based rotation trainer for retail WoW: pick a spec, import a Wowhead talent
build (loadout string), set up an action bar with your own keybinds, practice against
simulated procs/cooldowns/resources on a training dummy, and get a 0–100 execution score.

Full proposal with sources: published as the "Rotation Trainer Blueprint" artifact
(this file is the in-repo summary).

## Game context (verified Aug 2026)

- Patch 12.1 "Curse of Ula'tek" live since 2026-08-11; Midnight Season 2 since 2026-08-18.
- 13 classes / 40 specs (new: Devourer Demon Hunter). Level cap 90.
- Talents: class tree + spec tree + hero talents (2 per spec) + Apex Talents
  (keystone/node/capstone under the spec tree, unlocked at 81, rotation-relevant).
- Tier sets: standard 2pc/4pc, Season 2 smooths sustained damage.
- GCD floor still 0.75s with haste. 12.1 flattened burst profiles.
- 12.1 Altar of Corrosion is zone-scoped (Coiled Isle) — ignore.
- Hekili ended retail support at 12.0 (addon API lockdown); WeakAuras unsupported on
  Midnight. No maintained standalone rotation trainer exists → open niche.

## Data sources

| Source | Use |
|---|---|
| wago.tools (`/db2/{Table}/csv`) | Mechanics numbers: SpellMisc, SpellEffect, SpellCooldowns, SpellPower, SpellAuraOptions (procs/RPPM), TraitNode/TraitEdge/TraitDefinition. Schemas: github.com/wowdev/WoWDBDefs |
| SimulationCraft `midnight` branch | Validated spell data via SpellQuery; per-spec APLs (rotation oracle). GPL-3: re-derive data, don't embed code |
| Blizzard Game Data API | Names, descriptions, talent-tree topology, icons (self-host per media guide). OAuth client credentials, free, 36k req/h |
| Wowhead guides | Talent loadout strings, pasted by the user (Blizzard's format; parsers: TobiasM95/WoW-Talent-Tree-Manager, Snakybo/TalentParser, simc) |
| Hekili repo (frozen) | Reference catalog of per-spec state models (procs, auras, resources) |

## Architecture

- **App:** TypeScript + React + Vite, static site, no backend for v1 (localStorage).
- **Sim engine:** pure-TS package, event-driven; GCD, cast times, cooldowns/charges,
  resources, auras (duration/stacks/pandemic), procs (flat chance + RPPM). Seeded PRNG.
- **Spec modules:** hand-curated per spec (data pipeline generates the base ~80%,
  human models the interacting 20%) + the spec's APL translated to a small structured
  priority-list format (no general simc-APL interpreter in v1).
- **Data pipeline:** Node scripts run per patch → static JSON versioned per game build.

## Scoring (0–100)

Seeded deterministic RNG; after a run, an oracle bot replays the simc APL on the same
seed (identical procs). Headline: `round(100 * min(1, EDPS_player / EDPS_oracle))`
using expected (non-crit-lucky) damage. Subscores: decision accuracy per GCD (with
~0.5% near-tie tolerance vs oracle), uptime (dead GCDs), resource waste (capping),
cooldown drift. Debrief: per-cast Perfect/Good/Miss timeline with "oracle did X" tooltips.

## Roadmap

0. **Data spike (~1 wk):** one spec end-to-end — decode loadout string, wago.tools pull,
   cross-check vs simc SpellQuery, fetch icons.
1. **Engine + first spec (3–4 wk):** tested engine, training UI (bar + keybinds,
   resources/buffs/procs), dummy fight. Playable, unscored.
2. **Score (2–3 wk):** oracle replay, 0–100 + subscores, graded debrief timeline.
3. **Build import (2 wk):** talent string → actual sim modifiers incl. hero + Apex.
4. **More specs (ongoing, ~1 wk/spec):** prioritize popular, stable specs; later add
   fight events (movement, target swaps), AoE scenarios.

## Open decisions

- First spec (= whatever the user plays; avoid freshly reworked specs like MM Hunter).
- Confirm web-first (alternative: Unity desktop — not recommended).
- v1 is single-target dummy only.

## Legal

Free/non-commercial; icons self-hosted from Blizzard API; no Wowhead scraping (users
paste strings); re-derive simc data rather than embedding GPL code.
