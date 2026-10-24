# Changelog

All notable changes to OC Command Centre. Updates install automatically through your userscript manager.

Versions before 4.0.0 were private test builds. Only the main ones are listed, and each includes the smaller fixes released since the version below it.

## 4.3.0 · 2026-10-24

### Changed
- **The dashboard is now limited to positions with Torn's "Organised Crimes" permission**, plus the Leader and Co-leader. Previously any key with Faction API access unlocked it. Everyone else gets the member menu, with a message explaining why. This uses each faction's own positions, set under faction controls → positions.
- Saved keys are rechecked every 6 hours, so permission changes are picked up. If the position or its permissions can't be read (for example, a temporary API error), access isn't removed.

### Notes
- Leader keys now also use the `faction → positions` and `user → basic, faction` selections. A Minimal key already includes them.

## 4.2.0 · 2026-10-23

### Added
- **Travel warning (optional).** Add your own Minimal API key in the member menu, and Torn's travel page warns you when a round trip would get you back after your OC is due to start. It lists the destinations that still get you back in time with a standard ticket, or says when the OC is ready and flying now would delay it. Leaders don't need an extra key: their saved key is used. The warning can be turned off in settings.
- A Terms of Service table for the travel-warning key, shown where the key is entered.

### Notes
- One API call (`user → organizedcrime`) when you open the travel page, then at most one a minute while it stays open. Nothing is clicked and travel is never blocked.

## 4.1.1 · 2026-10-20

### Fixed
- **"Unavailable" alerts no longer fire for members who will be back in time.** A hospital or jail stay that ends at least 5 minutes before the OC is due to start no longer counts, in both OC BREACH alerts and Needs attention. Travelling members still count, because Torn gives no landing time.
- Removed a stray space in status text ("44 mins , Ace in the Hole").

## 4.1.0 · 2026-10-20

### Changed
- **Slimmer summary card.** The card on the crimes page is now a single slim line by default. The ▾ button shows the colour legend and notices, and the script remembers your choice.
- **Card position setting.** Choose top of the list, bottom of the list, or off, in both the leader settings and the member menu. On Torn PDA the card stays at the top, because it's how you open settings there.
- **Simpler report filters.** The Item owner filter is removed. The Crime type filter now shows only on Item costs and Activity log, and the Overview always covers every crime in the period.

### Added
- An ownership breakdown on the Item costs tab, which follows the crime filter.

### Fixed
- "Unknown owner" is hidden from the ownership breakdown when there are none.

## 4.0.3 · 2026-10-19

### Changed
- **The stall timer shows for every faction.** It no longer needs the joining policy to be turned on. The OK TO JOIN / WAIT / START NEW banners, LAST JOIN and policy ordering are still policy-only.

## 4.0.2 · 2026-10-19

### Fixed
- **Faster menu opening.** The dashboard no longer waits for Torn's item list to load before showing. Item names fill in a moment later, and OC BREACH alerts still wait for them so they name the missing item.

## 4.0.1 · 2026-10-19

### Changed
- CPR is shown as a plain number, like Torn's own (71, not 71%), in OC BREACH alerts, Needs attention and the crime slot table.

## 4.0.0 · 2026-10-19

First public release.

- **For every member (no API key):** CPR colours on every role, a status bar on each OC, Join buttons that explain why they're greyed out, hidden crimes, role weights from Torn Probability, and CPR rules that update automatically from faction newsletters.
- **For leaders (Faction API access):** a live overview, estimated success, OC BREACH alerts, reports with item costs and CSV exports, a CPR settings editor with an optional joining policy, and settings codes with a ready-to-send newsletter.
- Works with Tampermonkey, Violentmonkey and Torn PDA.

Changes since 3.8.2:
- **Status bar on each OC.** One tidy bar per OC holds the join status, the stall timer ("Stalls in 3h 20m", "MEMBERS NEEDED NOW") and LAST JOIN / JOINED TOO EARLY.
- **Join reasons.** Greyed-out Join buttons show why underneath, for example "Needs 73 · you have 70" or "Hidden crime".
- **Possible early joins** now also appear in the dashboard's Needs attention list.
- **Torn API error 17** (a temporary Torn server error) is retried automatically, with a clearer message.
- A "What members see" box in CPR settings, and simpler CPR requirement wording.
- Removed the success chance from the crimes page. It stays in the leader dashboard, where it's projected correctly.

## 3.8.2

### Changed
- **The joining policy is off by default.** It's a separate section in CPR settings, and its options (wait limit, start-last OCs, exception roles, low-scope fallback) only show when it's turned on. Members can choose "As set by my faction's code", "Always" or "Never".
- Clearer descriptions for the wait limit and the low-scope fallback.

## 3.8.0

### Added
- **Torn PDA support.** Requests go through Torn PDA's own layer, and members open settings from the crimes-page card, because PDA has no userscript menu.
- **More OC BREACH alerts** for an OC starting within the hour: a member missing their item (naming the item), or a member who is unavailable. These work without CPR rules.
- **"What changed" on newsletter imports.** Members see a short list of the rule changes, with Undo.
- Missing items are named in Needs attention.

## 3.7.6

### Added
- **A clearer API key section.** Regular members are told they don't need a key, with who does need one (positions with Faction API access) and which key level.
- A green "CPR settings imported" confirmation in the member menu, showing where the rules came from and when.
- A Credits section.

## 3.7.0

### Added
- **Estimated success for recruiting crimes.** Crimes still recruiting get a projected chance, shown as "≥X%", with open roles counted at their minimum CPR. Full crimes show the real figure. Roles are matched to Torn Probability by name.

## 3.6.2

### Added
- **A ready-to-send newsletter.** Generating a settings code also writes the newsletter text around it, with Copy buttons, so leaders can paste it straight into a faction newsletter.
