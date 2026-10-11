# impede

Hides Discord's ads and upsells: Quests and Orbs, Nitro and Shop promotions, and Server Boost prompts. It comes in two forms, a [Vencord](https://github.com/Vendicated/Vencord) userplugin ([`index.ts`](index.ts)) and a CSS theme ([`impede.theme.css`](impede.theme.css)). Install one of them, not both.

## Plugin or theme

The plugin stops upsells from rendering at all. They never report "viewed" analytics, a hidden promo notice does not hold back a payment warning, and lists close up around removed rows. Each item has its own toggle, and Vencord's reporter lists the patches a Discord update has broken. It needs Vencord built from source.

The theme hides the same things with CSS. It needs no build and loads in any client mod that takes CSS themes: Vencord, Vesktop, Equicord and BetterDiscord. Everything is hidden by default, and hidden elements still load and report analytics; see [Theme limitations](#theme-limitations).

With both installed, the theme hides everything whatever the plugin's settings say, so turning a plugin setting off has no visible effect.

## Install

### Plugin

impede is a userplugin, so it needs Vencord built from source ([guide](https://docs.vencord.dev/installing/)).

```sh
cd Vencord/src/userplugins
git clone https://forgejo.causticpotato.org/abdulyasmin/impede.git impede
cd ../..
pnpm build
pnpm inject   # first time only
```

Restart Discord and enable **Impede** in Settings → Vencord → Plugins. The cog next to it opens the settings listed under [What it hides](#what-it-hides). Clone the repo into `src/userplugins` rather than symlinking it there: esbuild follows the link to the real path, which has no `tsconfig.json`, and the `@api/...` imports fail to resolve.

To update, run `git pull` in `src/userplugins/impede` and `pnpm build` in the Vencord folder, then restart Discord.

### Theme

1. Download [`impede.theme.css`](https://forgejo.causticpotato.org/abdulyasmin/impede/raw/branch/main/impede.theme.css).
2. In Vencord, Vesktop or Equicord, open Settings → Themes → Local Themes and click **Open Themes Folder**. In BetterDiscord, open Settings → Themes and click **Open Themes Folder**.
3. Move the file into that folder and switch the theme on.

Each rule in the file has a comment saying what it hides; delete a rule to keep that element. To update, download the file again over the old one. Pasting the file's contents into Vencord's QuickCSS also works. Adding the raw link under Online Themes does not: Vencord's content security policy only allows stylesheets from a few hosts, and Forgejo serves raw files as plain text, which Discord will not apply as a stylesheet.

## What it hides

Each item has its own toggle in the plugin settings. Items marked "restart" are webpack patches and take effect after Discord reloads; the rest switch immediately. The theme hides all of them except `questBadges` and `blockQuestFetch`, including the ones the plugin leaves off by default, and it hides Settings → Nitro whether or not you subscribe.

| Setting | Hides | Default | Applies |
|---|---|---|---|
| `dmQuests` | Quests row in the DM list | on | restart |
| `questBar` | Sponsored Quest bar above the account panel | on | restart |
| `discoverQuests` | Quests tab in Discover | on | restart |
| `activeNowQuest` | Quest promos on Active Now cards | on | restart |
| `memberQuestIcon` | "Playing a Quest" icon in the member list | on | restart |
| `questEmbeds` | Quest embeds in chat, Orbs icon in the status menu | on | live |
| `questBadges` | Quest and Orb profile badges, including your own | off | restart |
| `blockQuestFetch` | Stops the client fetching Quests at all | off | restart |
| `dmNitro` | Nitro row in the DM list | on | restart |
| `dmShop` | Shop row in the DM list | on | restart |
| `giftButton` | Gift button in the chat bar | on | restart |
| `nagbars` | Promotional notice bars (payment problems stay) | on | restart |
| `coachmarks` | Nitro, Shop, Quest and Boost coachmarks, popovers and "new" badges | on | restart |
| `lockedEmoji` | Emoji you need Nitro to use | on | restart |
| `messageLength` | Nitro upsell when a message is too long | on | restart |
| `inlineUpsells` | Nitro banners in pickers, profiles, Super Reactions and appearance settings | on | live |
| `giftPromotions` | Partner promotions in Settings → Gift Inventory | on | live |
| `nitroSettings` | Settings → Nitro, only when you have no subscription | on | live |
| `boostBar` | Boost progress bar in the channel list | on | restart |
| `boostRow` | "Server Boosts" row in the channel list | on | restart |
| `boostMenuItem` | "Server Boost" in the server dropdown | on | live |
| `boostSettings` | Settings → Server Boost, including boost-slot management | off | live |

It leaves alone Settings → Subscriptions and Billing, notices about failed or overdue payments, and the file-size upsell modal (hiding a modal with CSS leaves its focus lock in place and freezes the app).

## Theme limitations

CSS cannot do everything the plugin does:

- Quest and Orb profile badges stay visible. Their icons come from Discord's servers, so the client code has nothing stable to select.
- Quests are still fetched, and hidden upsells still mount and report "viewed" analytics and ad impressions.
- Discord shows one notice bar at a time. A promo notice hidden with CSS still holds that slot, so a payment-problem notice queued behind it stays hidden until the promo ends.
- Hidden DM-list and channel-list rows leave blank space at the end of those lists, and hidden DM rows still take arrow-key focus.
- Nitro-locked emoji leave blank cells instead of disappearing.
- The coachmark rule also hides a few feature tips that use the same Nitro gradient, and coachmarks hidden this way are never dismissed.
- The partner-promotion notice rule uses a build-specific class hash and stops matching when Discord rebuilds that stylesheet.

## How it works

Most surfaces are removed by webpack patches that stop the component from rendering. A patched upsell never mounts, so it also never reports an "upsell viewed" event, and when Discord changes the code Vencord logs the patch as failed instead of hiding the wrong thing. Patches are anchored on strings Discord needs for its own purposes (React list keys, route enums, flux action names, analytics reasons, intl keys), which have lasted much longer than the regexes around them.

A stylesheet covers the rest: CSS fallbacks for the patched surfaces, using routing and test attributes (`href`, `data-testid`, `data-settings-sidebar-item`) that survived Discord's class-name changes in 2023 and 2025, and small inline upsells that have no stable code anchor. Those use `[class*="name_"]` selectors, which match both of Discord's current class shapes (`name_abc123`, `name__0abcd`). Each prefix was checked against all CSS in Discord build 634304: each matches only upsell classes, except `notice_`, which is only used together with `colorPremium`.

The research behind these choices, with sources, is in [reports/Hiding Discord upsells in Vencord.md](reports/Hiding%20Discord%20upsells%20in%20Vencord.md).

## Maintenance

Expect a patch regex to break somewhere most months; the gift button and DM-list rows break most often. Vencord's reporter loads logged-out discord.com in headless Chrome and lists every patch that no longer matches:

```sh
cd Vencord
pnpm buildReporter
npx esbuild scripts/generateReport.ts > dist/report.mjs
CHROMIUM_BIN="/path/to/chrome" node dist/report.mjs
```

The reporter does not test CSS selectors, the plugin's or the theme's, so a stale selector shows the upsell again with no warning.

If you use Equicord with Declutter enabled, turn off the overlapping DM-list settings in one of the two plugins; Declutter already removes those rows, and impede's keyboard-navigation patch will report "had no effect".

## What it will not do

- Complete, enrol in, or send progress for Quests. Discord penalises quest automation with quest bans and account-standing strikes.
- Pretend you have Nitro. Overriding the premium type removes some upsells but makes the client attempt Nitro features that the server rejects.
- Write dismissals to your account. The coachmark filter is client-side and stops when the plugin is disabled.

Client mods of any kind are against Discord's Terms of Service. There are no known cases of enforcement against mods that only hide UI.

## Development notes

Vencord's ESLint config requires its own GPL header on every file under `src/`, so `pnpm lint` reports `simple-header/header` on `index.ts`, which carries this project's AGPL header instead. Build and `tsc` pass.

## Credits

Several patches are adapted from GPL-3.0-or-later code: Equicord's [Declutter](https://github.com/Equicord/Equicord/tree/main/src/equicordplugins/declutter) and [Questify](https://github.com/Equicord/Equicord/tree/main/src/equicordplugins/questify), and Vencord's [CharacterCounter](https://github.com/Vendicated/Vencord/tree/main/src/plugins/characterCounter). Section 13 of the AGPL permits combining them; those parts remain under the GPL. `index.ts` marks which patches came from where.

## License

AGPL-3.0-or-later; see [LICENSE](LICENSE).
