# impede

Hides Discord's ads and upsells: Quests and Orbs, Nitro and Shop promotions, and Server Boost prompts. It comes in two forms, a [Vencord](https://github.com/Vendicated/Vencord) userplugin ([`index.ts`](index.ts)) and a CSS theme ([`impede.theme.css`](impede.theme.css)). Install one of them, not both.

## Quickstart

The theme needs no build and updates itself.

In Vencord, Vesktop, Equicord or Equibop, open Settings → Themes → Online Themes and add this link:

```
https://abdulyasmin.github.io/impede/impede.theme.css
```

In BetterDiscord, open Settings → Themes, click **Open Themes Folder**, save [`impede.online.theme.css`](https://forgejo.causticpotato.org/abdulyasmin/impede/raw/branch/main/impede.online.theme.css) into that folder, and switch impede on.

Discord loads the theme from GitHub Pages each time it starts or reloads (Ctrl+R), so each release reaches you without a download. To install it from a terminal, or to keep a copy you can edit, see [Theme](#theme). The plugin hides more but needs Vencord built from source; see [Plugin or theme](#plugin-or-theme).

## Plugin or theme

The plugin removes upsells with code patches and CSS fallbacks. Patches that prevent a component from mounting also prevent its "viewed" analytics; CSS fallbacks do not. The notice-store patch lets payment warnings through when it skips a promotion, and list patches close up around removed rows. Each item has its own toggle, and Vencord's reporter lists patches that no longer match after a Discord update. It needs Vencord built from source.

The theme hides what CSS can reach of the same things. It needs no build and loads in any client mod that takes CSS themes: Vencord, Vesktop, Equicord, Equibop and BetterDiscord. Every included rule is enabled by default. Hidden elements still load and report analytics, and modals and popups stay; see [Theme limitations](#theme-limitations).

With both installed, the theme applies its rules regardless of the plugin's settings, so turning a plugin setting off may have no visible effect.

## Install

`install.sh` (macOS and Linux) and `install.ps1` (Windows) install either form and update the plugin. The steps they automate are written out below each.

### Plugin

You need git and Node.js 22 or newer. On Windows, `winget install Git.Git OpenJS.NodeJS.LTS` installs both; on macOS, `xcode-select --install` provides git and [nodejs.org](https://nodejs.org/en/download) or Homebrew provides Node; on Linux, use your package manager. The script uses Vencord's pinned pnpm version, running it through npx if your installed pnpm has a different version or is missing.

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
| `--schedule`, `-Schedule` | Also update every day; see [Updating the plugin](#updating-the-plugin) |

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

To update by hand, run `git pull` in `Vencord` and in `src/userplugins/impede`, then `pnpm install --frozen-lockfile` and `pnpm build`, and restart Discord. Clone impede into `src/userplugins` rather than symlinking it there: esbuild follows the link to the real path, which has no `tsconfig.json`, and the `@api/...` imports fail to resolve.

Patching Discord differs between systems:

- Windows: the installer closes Discord before patching it. When Discord updates itself into a new `app-*` folder, Vencord copies its patch across.
- macOS: if patching fails with "operation not permitted", allow your terminal app under System Settings → Privacy & Security → App Management and try again.
- Linux: Discord under `/usr` or `/opt`, or installed as a system-wide Flatpak, needs root to patch, and `pnpm inject` cannot ask for it. The script offers to retry as root. By hand, after `pnpm inject` has downloaded the installer, run `sudo env VENCORD_USER_DATA_DIR="$PWD" VENCORD_DEV_INSTALL=1 dist/Installer/VencordInstallerCli-linux --install` in the Vencord folder. Vencord does not support the Snap package of Discord.
- Vesktop, on any system: skip `pnpm inject`. In Vesktop's settings, click **Open Developer Settings** at the bottom, set **Vencord Location** to the `dist` folder in your Vencord checkout, and restart Vesktop. The Flatpak build first needs `flatpak override --user dev.vencord.Vesktop --filesystem="$HOME/Vencord"`; without it, the location becomes a temporary path that breaks after a restart.

If a Discord update removes Vencord, patch it again by rerunning the script with `plugin`, or with `pnpm inject`.

#### Updating the plugin

Vencord's own updater (Settings → Vencord → Updater) pulls Vencord only. It leaves impede at the commit you installed, because Vencord's git ignores `src/userplugins`.

The scripts' `update` command updates both. It pulls Vencord and impede and rebuilds when either changed or required build files are missing. It does not patch Discord again. Restart Discord after the update finishes to use the new build.

The scripts refuse to update a checkout with local changes and prevent two installer runs from updating the same checkout at once. They save the previous `dist` folder before building and restore it if dependency installation or the build fails. Git pulls are fast-forward only; a failed build leaves the source checkouts at their new revisions so the next run retries the build.

Vencord writes directly into `dist`, so wait for the update to finish before starting or reloading Discord. A power loss or forced process termination can interrupt recovery. The backup is beside the Vencord checkout, named `Vencord.impede-build.*` on macOS/Linux or `Vencord.impede-build-*` on Windows. On macOS/Linux, remove a leftover `Vencord.impede-lock` directory only after checking that no installer is running. If recovery is needed, preserve the backup and restore its `dist` folder before restarting Discord.

```sh
sh install.sh update
```

```powershell
powershell -ExecutionPolicy Bypass -File install.ps1 update
```

Add `--schedule` (`-Schedule`) to `update`, or to the first `plugin` run, to run `update` every day:

| System | Job | When | Output |
|---|---|---|---|
| Linux | systemd user timer `impede-update.timer` | once a day, catching up after the computer was off | `journalctl --user -u impede-update` |
| macOS | launch agent `org.causticpotato.impede.update` | at login and at noon | `~/Library/Logs/impede-update.log` |
| Windows | Task Scheduler task "impede update" | at noon, or as soon as possible after a missed run | `%LOCALAPPDATA%\impede-update.log`, for the last run only |

A new build applies the next time Discord starts. The job runs the copy of the script in the impede checkout, so the script updates too. `--unschedule` (`-Unschedule`) removes the job. If your Vencord checkout is not `~/Vencord`, pass `--vencord-dir` (`-VencordDir`) to `update` as well.

On macOS and Linux, the job uses the Node.js that you scheduled it with. If a version manager such as fnm or nvm later removes that version, schedule again. On Windows, the task finds node through the PATH saved in Windows, and the script warns when node is not on it. Linux without systemd is not supported; the script prints the command to add to your crontab instead.

### Theme

The [Quickstart](#quickstart) adds the theme by hand. The scripts install it into the themes folder of every client mod they find, including Flatpak installs on Linux. On macOS or Linux, with `install.sh` downloaded as above:

```sh
sh install.sh theme
```

On Windows, with `install.ps1` downloaded as above:

```powershell
powershell -ExecutionPolicy Bypass -File install.ps1 theme
```

They save [`impede.online.theme.css`](https://forgejo.causticpotato.org/abdulyasmin/impede/raw/branch/main/impede.online.theme.css) in each themes folder as `impede.theme.css`, replacing any older copy. That file holds the theme's header and an `@import` of the theme on GitHub Pages, so it updates the same way the Online Themes link does. Then switch impede on in Settings → Themes.

With `--copy` (`-Copy`), the scripts copy the whole [`impede.theme.css`](https://forgejo.causticpotato.org/abdulyasmin/impede/raw/branch/main/impede.theme.css) instead. Each rule in it has a comment saying what it hides; delete a rule to keep that element. The copy works without GitHub Pages but does not update. To update it, download the file again, or run a freshly downloaded script with `--copy` again; without `--copy`, the script replaces your copy with the online file. To copy it by hand, open the themes folder (in Vencord, Vesktop or Equicord, Settings → Themes → Local Themes → **Open Themes Folder**; in BetterDiscord, Settings → Themes → **Open Themes Folder**), move the file into it, and switch the theme on. Pasting the file's contents into Vencord's QuickCSS also works.

The themes folders are:

| Client | Windows | macOS | Linux |
|---|---|---|---|
| Vencord | `%APPDATA%\Vencord\themes` | `~/Library/Application Support/Vencord/themes` | `~/.config/Vencord/themes` |
| Vesktop | `%APPDATA%\vesktop\themes` | `~/Library/Application Support/vesktop/themes` | `~/.config/vesktop/themes` |
| Equicord | `%APPDATA%\Equicord\themes` | `~/Library/Application Support/Equicord/themes` | `~/.config/Equicord/themes` |
| Equibop | `%APPDATA%\equibop\themes` | `~/Library/Application Support/equibop/themes` | `~/.config/equibop/themes` |
| BetterDiscord | `%APPDATA%\BetterDiscord\themes` | `~/Library/Application Support/BetterDiscord/themes` | `~/.config/BetterDiscord/themes` |

With the Discord Flatpak, the Linux folders are under `~/.var/app/com.discordapp.Discord/config/` instead of `~/.config/`. The Vesktop Flatpak uses `~/.var/app/dev.vencord.Vesktop/config/vesktop/themes`.

Use the GitHub Pages link rather than a raw file link. Forgejo and GitHub serve raw files as plain text, which Discord will not apply as a stylesheet unless the client mod corrects it (Vencord does), and the Forgejo host is not on Vencord's list of allowed theme hosts.

## What it hides

Each item has its own toggle in the plugin settings. Items marked "restart" are webpack patches and take effect after Discord reloads; the rest switch immediately. The theme covers many of the same surfaces, including some the plugin leaves off by default, but cannot filter fetched data or identify every upsell safely. It hides Settings → Nitro whether or not you subscribe; see [Theme limitations](#theme-limitations).

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
- Modals and popups stay: the Nitro announcement and reverse-trial modals, the file-too-large and limit dialogs, the server-cap modal and the Super Reaction modal. Hiding a modal with CSS leaves its focus lock in place and freezes the app, so the theme hides only identifiable Get Nitro buttons inside them.
- The Super Reaction toggle stays, and so does Nitro wording in plain text: the emoji, sticker and Soundmoji popout descriptions, quest rewards, the Orb wallet and a loading-screen tip.
- Wishlists and some profile promotions stay when their only selectors are generic layout or card classes shared with ordinary content.
- Buttons identifiable only by the Nitro icon stay visible. Subscription-management actions such as "keep Nitro" use that icon too.
- Some dark promotional notices stay visible because their layout is shared with account notices. Warning and danger notices, and notices with subscription-management icons, are excluded from the general promo rules.
- The coachmark rule also hides a few feature tips that use the same Nitro gradient, and coachmarks hidden this way are never dismissed.
- The partner-promotion notice rule uses a build-specific class hash and stops matching when Discord rebuilds that stylesheet.

## How it works

Most surfaces are removed by webpack patches. Some prevent mounting, while others filter data or remove an upsell after the component's hooks run. Patches use React list keys, route enums, flux action names, analytics reasons and intl keys as anchors. Vencord reports replacements that fail to match, but a matching regex does not prove the surrounding behavior is unchanged. Subscription-dependent rendering keeps hooks in their original order, and subscriber controls stay available while the current account is unknown.

A stylesheet covers the rest with routing and test attributes (`href`, `data-testid`, `data-settings-sidebar-item`) and class prefixes for inline upsells. The `[class*="name_"]` selectors match both class shapes (`name_abc123`, `name__0abcd`). Discord can rename or reuse those classes. Generic profile-layout and card selectors are omitted, and payment-warning exclusions take precedence over promotional notice styles.

## Maintenance

Discord updates can break patch regexes and CSS selectors. A replacement or selector that stops matching usually brings back its upsell, but partial matches or changed component behavior need review too.

`tests/discord_report.mjs` loads logged-out discord.com in headless Chromium with Vencord's reporter build, which loads every lazy chunk. It reports Impede patches and finds that no longer match, including `all: true` patches whose find matches no module, and class names, ids and attribute values in the theme and the plugin's CSS fallbacks that no Discord stylesheet or module contains any more. From a Vencord checkout with impede in `src/userplugins/impede`:

```sh
pnpm buildReporter
CHROMIUM_BIN="/path/to/chromium" node src/userplugins/impede/tests/discord_report.mjs
```

The `report` workflow runs it every day against the current Vencord main, and after each change to the plugin or the theme. A selector that is still present can match a different element after a Discord change, and logged-in behavior is not tested, so check the affected screens after changing patches or selectors.

If you use Equicord with Declutter enabled, turn off the overlapping DM-list settings in one of the two plugins; Declutter already removes those rows, and impede's keyboard-navigation patch will report "had no effect".

## What it will not do

- Complete, enrol in, or send progress for Quests. Discord penalises quest automation with quest bans and account-standing strikes.
- Pretend you have Nitro. Overriding the premium type removes some upsells but makes the client attempt Nitro features that the server rejects.
- Write dismissals to your account. The coachmark filter is client-side and stops when the plugin is disabled.

Client mods of any kind are against Discord's Terms of Service. There are no known cases of enforcement against mods that only hide UI.

## Development notes

GitHub Pages serves the theme from the root of `main`; `.nojekyll` stops it from running Jekyll over the repository. A push to `main` reaches theme users once Pages has deployed it, and plugin users at their next `update`.

Vencord's ESLint config requires its own GPL header on every file under `src/`, so `pnpm lint` reports `simple-header/header` on `index.ts`, which carries this project's AGPL header instead. Build and `tsc` pass.

Run the local regressions from this repository with Node.js 24, Python 3 and Chromium's headless shell, which `npx playwright install --only-shell chromium` downloads. On Linux, full Chrome for Testing 151 and 154 hang on the theme test's `--dump-dom`.

```sh
node tests/plugin.test.mjs
python3 tests/install_test.py
CHROMIUM_BIN=/path/to/chrome-headless-shell python3 tests/test_theme.py
shellcheck install.sh
```

The plugin tests exercise subscription changes, hook order, notice filtering and lazy module recovery. The installer tests use temporary checkouts and mock git/pnpm, including failed builds, incomplete output, concurrent updates and invalid Vesktop settings. If `pwsh` is available, they also run the portable PowerShell cases; otherwise those cases are skipped. Set `IMPEDE_TEST_PWSH=/path/to/pwsh` to choose a PowerShell executable. Windows injection and Task Scheduler still need checks on Windows.

On macOS, also run `python3 tests/macos_test.py`. It checks native launchd registration, execution, rescheduling and removal with an isolated job that only records its arguments. It also checks plist escaping, theme replacement and Vesktop settings in temporary directories. If there is no GUI login, it tests a copy of the generated plist in the user domain with a Background session type; the original GUI plist stays unchanged.

The theme tests load the complete stylesheet in an offline browser and check that account notices and ordinary content remain visible. They use synthetic DOM fixtures, so they say nothing about the current Discord build; see [Maintenance](#maintenance). The `ci` workflow runs these regressions, except the macOS ones, on pushes to `main` and on pull requests, except those that change only documentation, with PowerShell 7 for the portable cases.

## Credits

Several patches are adapted from GPL-3.0-or-later code: Equicord's [Declutter](https://github.com/Equicord/Equicord/tree/main/src/equicordplugins/declutter) and [Questify](https://github.com/Equicord/Equicord/tree/main/src/equicordplugins/questify), and Vencord's [CharacterCounter](https://github.com/Vendicated/Vencord/tree/main/src/plugins/characterCounter). Section 13 of the AGPL permits combining them; those parts remain under the GPL. `index.ts` marks which patches came from where.

## License

AGPL-3.0-or-later; see [LICENSE](LICENSE).
