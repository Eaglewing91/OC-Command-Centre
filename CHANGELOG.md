# Changelog

All notable changes to OC Command Centre. Updates install automatically through your userscript manager.

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
