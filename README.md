# impede

Hides Discord's ads and upsells: Quests and Orbs, Nitro and Shop promotions, and Server Boost prompts. It comes in two forms, a [Vencord](https://github.com/Vendicated/Vencord) userplugin ([`index.ts`](index.ts)) and a CSS theme ([`impede.theme.css`](impede.theme.css)). Install one of them, not both.

## Plugin or theme

The plugin stops upsells from rendering at all. They never report "viewed" analytics, a hidden promo notice does not hold back a payment warning, and lists close up around removed rows. Each item has its own toggle, and Vencord's reporter lists the patches a Discord update has broken. It needs Vencord built from source.

The theme hides what CSS can reach of the same things. It needs no build and loads in any client mod that takes CSS themes: Vencord, Vesktop, Equicord, Equibop and BetterDiscord. Everything is hidden by default. Hidden elements still load and report analytics, and modals and popups stay; see [Theme limitations](#theme-limitations).

With both installed, the theme hides everything whatever the plugin's settings say, so turning a plugin setting off has no visible effect.

## Install

`install.sh` (macOS and Linux) and `install.ps1` (Windows) install either form, and running them again updates it. The steps they automate are written out below each.

### Plugin

You need git and Node.js 22 or newer. On Windows, `winget install Git.Git OpenJS.NodeJS.LTS` installs both; on macOS, `xcode-select --install` provides git and [nodejs.org](https://nodejs.org/en/download) or Homebrew provides Node; on Linux, use your package manager. pnpm is optional: when it is missing, the script runs the version Vencord pins through npx.

On macOS or Linux:

```sh
curl -fsSLO https://raw.githubusercontent.com/abdulyasmin/impede/main/install.sh
sh install.sh plugin
```

On Windows, in PowerShell:

```powershell
iwr https://raw.githubusercontent.com/abdulyasmin/impede/main/install.ps1 -UseBasicParsing -OutFile install.ps1
powershell -ExecutionPolicy Bypass -File install.ps1 plugin
```

The script clones Vencord into `~/Vencord`, clones impede into its `src/userplugins` folder, builds Vencord, and starts Vencord's installer, which lists the Discord installs it found and patches the one you pick. Options, with the PowerShell spelling second:

| Option | Effect |
|---|---|
| `--vencord-dir DIR`, `-VencordDir DIR` | Use this Vencord checkout, cloning it if missing |
| `--discord PATH`, `-Discord PATH` | Patch this Discord install without asking |
| `--vesktop`, `-Vesktop` | Point Vesktop at the build instead of patching Discord; quit Vesktop first |
| `--no-inject`, `-NoInject` | Build only |

Then quit Discord fully (not just its window), start it again, and enable **Impede** in Settings → Vencord → Plugins. The cog next to it opens the settings listed under [What it hides](#what-it-hides).

By hand, following Vencord's [install guide](https://docs.vencord.dev/installing/), with the same commands on every system:

```sh
git clone https://github.com/Vendicated/Vencord
cd Vencord
pnpm install --frozen-lockfile
git clone https://forgejo.causticpotato.org/abdulyasmin/impede.git src/userplugins/impede
pnpm build
pnpm inject
```

To update, run `git pull` in `Vencord` and in `src/userplugins/impede`, then `pnpm install --frozen-lockfile` and `pnpm build`, and restart Discord. Clone impede into `src/userplugins` rather than symlinking it there: esbuild follows the link to the real path, which has no `tsconfig.json`, and the `@api/...` imports fail to resolve.

Patching Discord differs between systems:

- Windows: the installer closes Discord before patching it. When Discord updates itself into a new `app-*` folder, Vencord copies its patch across.
- macOS: if patching fails with "operation not permitted", allow your terminal app under System Settings → Privacy & Security → App Management and try again.
- Linux: Discord under `/usr` or `/opt`, or installed as a system-wide Flatpak, needs root to patch, and `pnpm inject` cannot ask for it. The script offers to retry as root. By hand, after `pnpm inject` has downloaded the installer, run `sudo env VENCORD_USER_DATA_DIR="$PWD" VENCORD_DEV_INSTALL=1 dist/Installer/VencordInstallerCli-linux --install` in the Vencord folder. Vencord does not support the Snap package of Discord.
- Vesktop, on any system: skip `pnpm inject`. In Vesktop's settings, click **Open Developer Settings** at the bottom, set **Vencord Location** to the `dist` folder in your Vencord checkout, and restart Vesktop. The Flatpak build first needs `flatpak override --user dev.vencord.Vesktop --filesystem="$HOME/Vencord"`; without it, the location becomes a temporary path that breaks after a restart.

If a Discord update removes Vencord, patch it again by rerunning the script or `pnpm inject`.

### Theme

On macOS or Linux, with `install.sh` downloaded as above:

```sh
sh install.sh theme
```

On Windows, with `install.ps1` downloaded as above:

```powershell
powershell -ExecutionPolicy Bypass -File install.ps1 theme
```

The script copies the theme into the themes folder of each client mod it finds, including Flatpak installs on Linux. Then switch impede on in Settings → Themes.

By hand:

1. Download [`impede.theme.css`](https://forgejo.causticpotato.org/abdulyasmin/impede/raw/branch/main/impede.theme.css).
2. In Vencord, Vesktop or Equicord, open Settings → Themes → Local Themes and click **Open Themes Folder**. In BetterDiscord, open Settings → Themes and click **Open Themes Folder**.
3. Move the file into that folder and switch the theme on.

The themes folders are:

| Client | Windows | macOS | Linux |
|---|---|---|---|
| Vencord | `%APPDATA%\Vencord\themes` | `~/Library/Application Support/Vencord/themes` | `~/.config/Vencord/themes` |
| Vesktop | `%APPDATA%\vesktop\themes` | `~/Library/Application Support/vesktop/themes` | `~/.config/vesktop/themes` |
| Equicord | `%APPDATA%\Equicord\themes` | `~/Library/Application Support/Equicord/themes` | `~/.config/Equicord/themes` |
| Equibop | `%APPDATA%\equibop\themes` | `~/Library/Application Support/equibop/themes` | `~/.config/equibop/themes` |
| BetterDiscord | `%APPDATA%\BetterDiscord\themes` | `~/Library/Application Support/BetterDiscord/themes` | `~/.config/BetterDiscord/themes` |

With the Discord Flatpak, the Linux folders are under `~/.var/app/com.discordapp.Discord/config/` instead of `~/.config/`. The Vesktop Flatpak uses `~/.var/app/dev.vencord.Vesktop/config/vesktop/themes`.

Each rule in the file has a comment saying what it hides; delete a rule to keep that element. To update, download the file again over the old one. Pasting the file's contents into Vencord's QuickCSS also works.

In Vencord or Vesktop you can instead add `https://cdn.jsdelivr.net/gh/abdulyasmin/impede@main/impede.theme.css` under Settings → Themes → Online Themes. The theme then updates without a download, once jsDelivr's cache picks up the change. Forgejo and GitHub raw links do not work there: they serve the file as plain text, which Discord will not apply as a stylesheet.

## What it hides

Each item has its own toggle in the plugin settings. Items marked "restart" are webpack patches and take effect after Discord reloads; the rest switch immediately. The theme covers every row except `questBadges` and `blockQuestFetch` as far as CSS can, including the ones the plugin leaves off by default, and it hides Settings → Nitro and the Get Nitro buttons whether or not you subscribe.

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
| `lockedEmoji` | Emoji, stickers and soundboard sounds you need Nitro to use, in the pickers and in search | on | restart |
| `messageLength` | Nitro upsell when a message is too long | on | restart |
| `subscribeButtons` | "Get Nitro", "Subscribe" and "Upgrade" buttons everywhere, and the Get Nitro action in limit dialogs; only when you have no subscription | on | restart |
| `expressionUpsells` | Nitro text and buttons in emoji, sticker and Soundmoji popouts; the Super Reaction toggle (unless you have Nitro), its tooltip text and coachmark; the floating "Unlock with Nitro" bar and the locked-item card in the pickers; soundboard and entrance-sound upsells | on | restart |
| `profileUpsells` | Nitro and Shop asides and menu items on profiles; "Reorder badges with Nitro", the Nitro tenure badge modal and badge-directory buttons; Shop, try-it-out and Get Nitro banners in the profile editor and Settings → Profiles; Shop tiles, Shop previews and Nitro-only items in the decoration, effect and nameplate pickers (Nitro subscribers keep those items) | on | restart |
| `wishlists` | Shop wishlists in the profile popout and the full profile (sidebar and tab), including gifting from a friend's wishlist | on | restart |
| `nitroPopups` | The start-up Nitro announcement and reverse-trial modals; Go Live HD ribbon and locked-quality upsells; the Nitro offer when a file is too large, at the server or group-DM limit, or at the scheduled-message limit; "Share Nitro Perks" and "Powered by Nitro" cards; Nitro offers in Favorites, App Icon, Color Themes, camera backgrounds, Connections and Settings → Nitro; the Nitro step when boosting; Nitro pills and cards in Quests and the Orb wallet; a loading-screen tip | on | restart |
| `inlineUpsells` | Nitro banners in pickers, profiles, Super Reactions and appearance settings | on | live |
| `giftPromotions` | Partner promotions and "Claim all gifts with Nitro" in Settings → Gift Inventory; friend-anniversary badges, rows and gift prompts | on | restart |
| `nitroSettings` | Settings → Nitro, only when you have no subscription | on | live |
| `boostBar` | Boost progress bar in the channel list | on | restart |
| `boostRow` | "Server Boosts" row in the channel list | on | restart |
| `boostMenuItem` | "Server Boost" in the server dropdown | on | live |
| `boostSettings` | Settings → Server Boost, including boost-slot management | off | live |

When a limit stops you (file size, message length, server count, group size, scheduled messages), Discord's plain explanation stays and only the Nitro offer goes. It leaves alone Settings → Subscriptions and Billing, notices about failed or overdue payments, the notice that explains why video is off in a stage channel, and the Nitro page itself; with `subscribeButtons` on, that page has no buttons, so turn the setting off if you want to buy Nitro.

## Theme limitations

CSS cannot do everything the plugin does:

- Quest and Orb profile badges stay visible. Their icons come from Discord's servers, so the client code has nothing stable to select.
- Quests are still fetched, and hidden upsells still mount and report "viewed" analytics and ad impressions.
- Discord shows one notice bar at a time. A promo notice hidden with CSS still holds that slot, so a payment-problem notice queued behind it stays hidden until the promo ends.
- Hidden DM-list and channel-list rows leave blank space at the end of those lists, and hidden DM rows still take arrow-key focus.
- Nitro-locked emoji leave blank cells instead of disappearing. Locked stickers and sounds stay, as do the "Available with Nitro" search sections.
- Modals and popups stay: the Nitro announcement and reverse-trial modals, the file-too-large and limit dialogs, the server-cap modal and the Super Reaction modal. Hiding a modal with CSS leaves its focus lock in place and freezes the app, so the theme only hides the Get Nitro buttons inside them.
- The Super Reaction toggle stays, and so does Nitro wording in plain text: the emoji, sticker and Soundmoji popout descriptions, quest rewards, the Orb wallet and a loading-screen tip.
- The wishlist in the full profile's sidebar stays; its classes are shared with the Shop page.
- The Get Nitro button rule matches buttons by the Nitro icon, which a few subscriber buttons also carry, such as "keep Nitro" in the cancel flow. If you subscribe, delete that selector or use the plugin.
- The coachmark rule also hides a few feature tips that use the same Nitro gradient, and coachmarks hidden this way are never dismissed.
- The partner-promotion notice rule uses a build-specific class hash and stops matching when Discord rebuilds that stylesheet.

## How it works

Most surfaces are removed by webpack patches that stop the component from rendering. A patched upsell never mounts, so it also never reports an "upsell viewed" event, and when Discord changes the code Vencord logs the patch as failed instead of hiding the wrong thing. Patches are anchored on strings Discord needs for its own purposes (React list keys, route enums, flux action names, analytics reasons, intl keys), which have lasted much longer than the regexes around them.

A stylesheet covers the rest: CSS fallbacks for the patched surfaces, using routing and test attributes (`href`, `data-testid`, `data-settings-sidebar-item`) that survived Discord's class-name changes in 2023 and 2025, and small inline upsells that have no stable code anchor. Those use `[class*="name_"]` selectors, which match both of Discord's current class shapes (`name_abc123`, `name__0abcd`). Each prefix was checked against all CSS in Discord build 634304: each matches only upsell classes, except `notice_`, `ctaButton_`, `upsell_` and `buttonContainer_`, which are only used inside a selector that narrows them to an upsell.

## Maintenance

Expect a patch regex to break somewhere most months; the gift button and DM-list rows break most often. A broken patch only brings back its own upsell; the others keep working. Vencord's reporter loads logged-out discord.com in headless Chrome and lists every patch that no longer matches:

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
