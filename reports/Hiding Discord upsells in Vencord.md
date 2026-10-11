# Patch Discord's render code to hide upsells

As of Discord stable build 634304 (built 9 October 2026), impede should hide upsells mainly with Vencord webpack patches that stop each upsell from rendering, and keep a live-toggleable managed stylesheet for the small inline upsells that have no stable code anchor. Patches anchored on Discord's React keys, route enums, flux action names, analytics reason strings and intl keys can remove the DM-list Nitro, Shop and Quests rows together with their keyboard-navigation stops, the sponsored Quest bar, promotional nagbars, the chat-bar gift button, the boost progress bar, the "Server Boosts" channel row and Nitro-locked emoji. A patched component never mounts, so it never sends its "upsell viewed" event, and when Discord changes the code the patch logs a failure instead of hiding the wrong thing. All 22 patch regexes recommended below were run against the build-634304 module sources, and each `find` string occurs in exactly one module. CSS breaks without warning: Discord's class names keep a readable name plus a hex suffix shared by a whole CSS file, and only selectors on routing and test attributes (`href`, `data-list-item-id`, `data-settings-sidebar-item`, `data-testid`) have kept working through the naming changes of 2023 and 2025. Faking Nitro through `OverridePremiumTypeStore`, overriding experiments and blocking requests each act broadly but change client behaviour or expire quickly, so they belong behind opt-in settings at most. Suppressing Discord's own dismissible-content coachmarks is promising but no plugin has tried it. The account risk that Discord enforces in 2026 is quest automation, punished with quest bans and two-year account-standing strikes; there is no recorded enforcement against hiding UI. Code from Vencord, Equicord, mdga and the MIT and Unlicense projects can be reused under AGPL-3.0-or-later with attribution, unlicensed CSS lists have to be rewritten from Discord's DOM, and Discord-Adblock's non-AI licence rules out using it at all.

## Patches fail loudly and stop upsells before they mount

Vencord offers a userplugin five ways to suppress an upsell, and they differ most in what happens when Discord ships a new build. A webpack patch is a regex find-and-replace on one module's source. When the `find` string disappears or the `match` no longer applies, Vencord logs "found no module" or "had no effect" and the stock code runs; if a patched factory throws, Vencord falls back to the original factory ([Source](https://github.com/Vendicated/Vencord/blob/dev/src/webpack/patchWebpack.ts)). The patch reporter loads every lazy chunk, requires every module and lists patches that never matched or took more than 10 ms ([Source](https://github.com/Vendicated/Vencord/blob/dev/src/debug/runReporter.ts)). It tests nothing about CSS, store fields or flux events, so a stale selector shows the upsell again with no warning. A CSS rule also hides only the paint: React still mounts the component, runs its hooks and fires its analytics. Vencord's CharacterCounter plugin shows the alternative. It inserts `return null;` after `.PREMIUM_UPSELL);` and before `.PREMIUM_UPSELL_VIEWED`, so the message-length tooltip neither renders nor reports a view ([Source](https://github.com/Vendicated/Vencord/blob/dev/src/plugins/characterCounter/index.tsx)).

Layout and keyboard behaviour also favour patches. The DM-list rows appear a second time in a separate keyboard-navigation array (module 176522), which is why Equicord's Declutter has a second patch to drop the Nitro and Shop routes from it ([Source](https://github.com/Equicord/Equicord/blob/main/src/equicordplugins/declutter/index.tsx)); a row hidden with CSS still takes arrow-key focus. The emoji, sticker and soundboard pickers draw their Nitro-locked sections inside virtualised lists with precomputed heights, so `display:none` on a section leaves blank space or misplaces category jumps (read from the code, not observed in a client) ([Source](https://discord.com/assets/web.843cc7edc28c426c.js)). Modals are worse: hiding the fullscreen Xbox promotion with CSS left its focus lock in place and blocked the whole UI ([Source](https://codeberg.org/ridge/Discord-Adblock/issues/59)). The one cost of patches is that they are registered at startup, so toggling one needs a restart. Core plugins give each patch a `predicate` reading a `restartNeeded: true` setting, as NoPendingCount does ([Source](https://github.com/Vendicated/Vencord/blob/dev/src/plugins/noPendingCount/index.ts)). Managed styles, flux handlers and context-menu patches are applied in `start()` and removed in `stop()`, so they toggle live ([Source](https://github.com/Vendicated/Vencord/blob/dev/src/api/PluginManager.ts)).

| Technique | What it changes | When Discord updates | Layout and keyboard | Live toggle | Role in impede |
|---|---|---|---|---|---|
| Webpack patch | Render or store code; the upsell never mounts | Logged by Vencord and the reporter; stock UI returns | Clean when the nav list is patched too | No | Primary, wherever a stable anchor exists |
| Managed CSS | Paint only; component mounts, fetches and tracks | Silent | Hidden rows keep focus; virtualised lists leave gaps; hidden modals block input | Yes | Fallback, plus inline banners with no anchor |
| Store override (`premiumTypeOverride = 2`) | What the client believes your plan is | Store fields drift; reporter checks only `start()` | Client offers Nitro features the server refuses | Yes | Opt-in only, with a warning |
| Dismissible content | Which coachmarks and popovers Discord picks | Patch anchor logged like any patch; ids change per campaign | None | Client filter: no. Account writes: yes | Client-side filter for coachmarks; account writes opt-in |
| Experiment override | Which bucket a rollout uses | Meaningless once Discord ships or drops the experiment | Whatever the other bucket does | Yes | Not used |
| Request blocking | Whether data arrives at all | Callers that await the request stall | Surfaces render empty | Varies | Only Questify's quest-fetch gate, opt-in |

The store override is the broadest single switch. Equicord's NoNitroUpsell sets `OverridePremiumTypeStore.getState().premiumTypeOverride = 2` in `start()` and clears it in `stop()` ([Source](https://github.com/Equicord/Equicord/blob/e0e85c8d4f6dc73aac9368cf3f4b2200eac4d4b4/src/equicordplugins/noNitroUpsell/index.ts)). That removes upsells gated on `isPremium`, but it does nothing for the Nitro, Shop and Quests rows, the Quest bar or boost prompts, which Discord shows to subscribers too, and the client then believes it may upload larger files and use Nitro-only features that the server will refuse. The moonlight port of the same idea needed an exemption list covering file size, client themes, profile customisation and boost discounts, and marks itself "dangerZone" ([Source](https://github.com/Enovale/moonlight-extensions/blob/16fdf67d37f00b423655cafc20d5d8f8ce5dd265/src/noNitroUpsell/index.tsx)). NoNitroUpsell's `CONNECTION_OPEN` handler also returns early when `premiumTypeActual !== 2`, which looks inverted for users without Nitro, and it mutates the state object without emitting a change, so mounted components do not re-render.

Dismissible content (DC) is Discord's own off switch for small promotions. Each coachmark, nagbar, popover, badge and marketing modal has a numeric id (up to 847 in this build; about 250 of roughly 520 names match upsell terms), it stays hidden once its bit is set in the account-synced `userContent.dismissedContents` bitfield, and "fatigable" ones are capped at three shown per day ([Source](https://discord.com/assets/web.843cc7edc28c426c.js)). No Vencord or Equicord plugin uses it ([Source](https://github.com/Equicord/Equicord/tree/e0e85c8d4f6dc73aac9368cf3f4b2200eac4d4b4/src)). Writing the bits through Discord's own dismiss function makes suppression permanent and account-wide, including mobile, but each write goes to the settings-proto endpoint that docs.discord.food describes as "ratelimited heavily" ([Source](https://docs.discord.food/resources/user-settings-proto)), and selecting ids by name pattern would also dismiss onboarding tips. A client-only alternative patches the candidate filter in module 595529, `return e.filter(e=>null!=t&&!(0,A.c0)(t,e))`, so that it also drops a fixed list of upsell ids. That writes nothing to the account and stops when the plugin stops. I verified the anchor against build 634304 but did not trace which components take their candidates through this filter, so it is the least proven part of the design. DCs also do not cover whole categories: the DM rows, Quest Home, the Shop page and the Quest bar are not DCs, and each campaign brings new ids such as `TRIAL_FOR_ALL_2026_SETTINGS_BADGE` ([Source](https://discord.com/assets/web.843cc7edc28c426c.js)).

Experiment overrides do not help. Experiment ids are dated (`2026-07-quest-home-default-banner-removal`, `2026-09-web-sticker-picker-upsell-restyle`), stop mattering once Discord ships or drops them, and their control bucket is usually the existing upsell ([Source](https://discord.com/assets/web.843cc7edc28c426c.js)). The one experiment that hides a purchase surface, `2026-03-block-purchases`, is a purchase block: its hook returns true when the experiment is on or the billing country is `"RU"`, so forcing it would block real purchases ([Source](https://discord.com/assets/web.843cc7edc28c426c.js)). Vencord's Experiments plugin warns that experiments "might ... get your account disabled" ([Source](https://github.com/Vendicated/Vencord/blob/dev/src/plugins/experiments/index.tsx)). Request blocking, as in mdga's XHR guard that answers `/api/v*/quests` with a fake 204, or a third-party userplugin that wraps `fetch` and `FluxDispatcher.dispatch` ([Source](https://github.com/BxdiS/mdga/blob/bdad2677a914ba93f1bebace0d03371b822f3efd/packages/modules/no-quests/src/index.ts); [Source](https://github.com/jordanw0204-rgb/vencord-no-more-quests/blob/6755e05783ef80f8a59a1a4aee98a8ff42c228a6/index.ts)), risks the failure Vencord's NoTrack documents: some Discord code awaits a callback and stalls when it never resolves ([Source](https://github.com/Vendicated/Vencord/blob/dev/src/plugins/_core/noTrack.ts)). Questify's quest-fetch gate short-circuits Discord's own fetch action instead, which is the form impede should offer as an opt-in.

## Discord's classes keep the readable name and one hash per CSS file

Discord's class names come from CSS modules: a readable local name followed by a hex suffix. Build 634304 uses two shapes, `name_xxxxxx` (six hex characters, first a–f; 7,412 names) and `name__dxxxx` (a second underscore, then five hex characters starting with a digit; 12,800 names), for example `privateChannels_e6b769` and `channel__972a0` ([Source](https://discord.com/assets/web.843cc7edc28c426c.js)). All 3,284 class maps indexed in the build use one suffix for every class they export, so a suffix identifies a CSS file ([Source](https://discord.com/assets/d1695711974dfbdd.js)). The JavaScript class maps export mangled two-letter keys, such as `{kL:"container__0d0f9", L$:"progressContainer__0d0f9", ue:"boostCountText__0d0f9"}` for the boost bar, so a map cannot be looked up by property name and has to be found by value ([Source](https://discord.com/assets/93c6cc08f8c39193.js)). Whether a suffix stays the same from one build to the next has not been measured. NoThanksDiscord asserts that suffixes rotate every build ([Source](https://github.com/tony-nz/NoThanksDiscord/blob/1f61ae57221959618a8859fddec22f404e575b45/NoThanksDiscord.plugin.js)), while one suffix per file points to a file-derived hash. In either case a full hashed class is the least durable selector available.

The scheme has changed three times. The `name-hash` format gave way to `name_hash` in October 2023, when synthead's filter list had to change `li[class^="channel-"]` to `channel_` ([Source](https://github.com/synthead/discord-adfree/commit/e79466525f09d23ff611f576b1c45bf006152abb)). On 17 December 2025 Discord switched to `hash-name` ([Source](https://codeberg.org/AllPurposeMat/Disblock-Origin/issues/126)), and by 23–24 January 2026 it had switched back ([Source](https://codeberg.org/ridge/Discord-Adblock/issues/43); [Source](https://codeberg.org/AllPurposeMat/Disblock-Origin/issues/134)). Disblock Origin rewrote every `^=` selector to `*=` the same day and reverted that in February ([Source](https://codeberg.org/AllPurposeMat/Disblock-Origin/commit/40a24096b543922c00f49996f6ea2a2258cc81f5); [Source](https://codeberg.org/AllPurposeMat/Disblock-Origin/commit/f9a7a41cc155fc49883319b3fe4fdea68f17bad6)). Vencord added `findCssClassesLazy` that week; it matches class-map values with `(?<=^|\s)<name>(?:_\S*)?(?=$|\s)` and returns `{name: "name_hash"}` ([Source](https://github.com/Vendicated/Vencord/commit/702a71dee8ce29d78ffbdb14edbdf2c0947c9b25); [Source](https://github.com/Vendicated/Vencord/blob/16ec4ea838899706019e7f472e45f055070abeb1/src/webpack/webpack.ts)). That regex assumes the readable name comes first, so a return to `hash-name` would break it as well.

Selectors on attributes Discord needs for routing, list navigation and its own tests did not break in any of these changes. Route `href`s (`/store`, `/shop`, `/quest-home`), `data-list-item-id` suffixes (`___nitro`, `___shop`, `___quests`), `data-settings-sidebar-item`, `data-testid="quest-bar-container"` and element ids kept working; the route and list-id selectors each appear independently in three or more maintained projects, `data-testid` in two ([Source](https://codeberg.org/AllPurposeMat/Disblock-Origin/src/commit/76a96e7369fe95ed42cdb033d006357e9afd446b/DisblockOrigin.theme.css); [Source](https://github.com/LancersBucket/ChatButtonsBegone/blob/2ca0b8983220604e86a75083abd91f229635cd66/ChatButtonsBegone.plugin.js); [Source](https://github.com/BxdiS/mdga/blob/bdad2677a914ba93f1bebace0d03371b822f3efd/packages/modules/no-shop/src/index.ts)). They break only when Discord restructures the DOM, as on 28 July 2026 when the settings sidebar moved from `div` to `li` ([Source](https://codeberg.org/AllPurposeMat/Disblock-Origin/commit/40f6e5f93b9b1afb06e7f5261a045fc32866ff96)). The `data-list-item-id` values include a per-session uid (`private-channels-uid_11___shop`), so match the suffix, and never use `*="quests"`, which also matches `message-requests` ([Source](https://codeberg.org/AllPurposeMat/Disblock-Origin/issues/153); [Source](https://github.com/jordanw0204-rgb/vencord-no-more-quests/blob/6755e05783ef80f8a59a1a4aee98a8ff42c228a6/index.ts)).

Where impede has to use classes, `[class*="name_"]` matches both suffix shapes and multi-class values such as the notice bar's `colorPremiumTier0__6e2b9 colorPremium__6e2b9` ([Source](https://discord.com/assets/996499.854309e0a9a94209.js)); `^=` fails on both. Neither form would work if Discord returned to the December 2025 `hash-name` order; during that period only `*=` selectors written without the `_` separator kept matching, and Disblock switched every `^=` to `*=` ([Source](https://codeberg.org/AllPurposeMat/Disblock-Origin/commit/40a24096b543922c00f49996f6ea2a2258cc81f5)). English `aria-label`s, which synthead's list relies on, fail in every other locale ([Source](https://github.com/synthead/discord-adfree/blob/3877816b2cb8b9f7e20024728224d4a6144cc175/discord-adfree.txt)). Prefixes need a collision check: across the build's stylesheets, `notice_` matches about twenty unrelated classes, `upsellContainer_` occurs in eight CSS files and `shopIcon_` in six, while `inlineUpsell_`, `premiumTryItOutSection_`, `questEmbedCard_` and `containerQuestBarVisible_` are each unique (my count over the CSS served with build 634304 ([Source](https://discord.com/app))). For a generic name such as `container`, resolve the full class at runtime from a distinctive sibling in the same file: `findCssClassesLazy("container", "progressContainer", "boostCountText")` returns the boost bar's `container__0d0f9`. Vencord's `setStyleClassNames` then substitutes it for a `[--name]` placeholder in a managed stylesheet ([Source](https://github.com/Vendicated/Vencord/blob/dev/src/api/Styles.ts)); no core plugin uses the placeholder feature yet, so test it. Keep `:has()` rules few and anchored with child combinators, because users of both large CSS lists reported lag they blamed on `:has()`, and Vencord itself deletes one of Discord's `:has()` rules to fix "css lag" ([Source](https://codeberg.org/AllPurposeMat/Disblock-Origin/issues/134); [Source](https://github.com/Vendicated/Vencord/blob/dev/src/plugins/_core/fixDiscordCss.ts)).

## Equicord's finds have lasted two years; its regexes and every CSS list needed regular repair

Vencord core will not take a plugin that only hides UI. Its rules say "No plugins that simply hide or redesign ui elements. This can be done with CSS" ([Source](https://github.com/Vendicated/Vencord/blob/16ec4ea838899706019e7f472e45f055070abeb1/CONTRIBUTING.md)), and issue #4405, a July 2026 request for options to hide Quest UI, was closed as not planned ([Source](https://github.com/Vendicated/Vencord/issues/4405)). Core plugins remove upsells only as side effects: CharacterCounter drops the message-length tooltip and NoPendingCount zeroes the Nitro offer count ([Source](https://github.com/Vendicated/Vencord/blob/dev/src/plugins/noPendingCount/index.ts)). The working prior art is in Equicord. Declutter (formerly Anammox) removes the DM-list Nitro, Shop and Quests rows, the boost progress bar, the Billing settings section, the chat-bar gift button and Nitro-locked emoji with webpack patches, each behind a restart-required setting ([Source](https://github.com/Equicord/Equicord/blob/e0e85c8d4f6dc73aac9368cf3f4b2200eac4d4b4/src/equicordplugins/declutter/index.tsx)). Questify hides the Quest surfaces and can stop quest fetching, but ships in one plugin with quest auto-completion ([Source](https://github.com/Equicord/Equicord/blob/e0e85c8d4f6dc73aac9368cf3f4b2200eac4d4b4/src/equicordplugins/questify/index.tsx)).

Declutter's history shows which part of a patch lasts. Its `find` strings `tutorialId:"direct-messages"` and `.hasLibraryApplication()&&!` have been unchanged since 14 October 2024 ([Source](https://github.com/Equicord/Equicord/commit/deceb2ba97d98cf6825aa4d9c0d10f57a33fef55)). The `match` regexes inside them were not: the Nitro-row match was rewritten on 5 January 2026, the Quests match on 18 May and 26 August 2026, the boost-bar match three times on 2 February 2026, the Billing patch four times between December 2025 and June 2026, and the gift button went through several fixes and reverts in November 2025 and January 2026 ([Source](https://github.com/Equicord/Equicord/commit/b094b1f0dbc203bc4bec3b7648db21fa907be1d1); [Source](https://github.com/Equicord/Equicord/commit/56dac8b012637e8a403b7374028280ab6528c6ec); [Source](https://github.com/Equicord/Equicord/commit/2b3b2cdfd82a7bc88ab3a2e2379ad3df71cc7231); [Source](https://github.com/Equicord/Equicord/commit/6146e90c38add861825e29b1c0501e346e4be610); [Source](https://github.com/Equicord/Equicord/commit/6b2c5f69351df3248ee5758bb28767e0faec6875)). Declutter and Anammox took **56 commits** between July 2025 and October 2026, and Questify **196** between August 2025 and October 2026 ([Source](https://github.com/Equicord/Equicord/commits/e0e85c8d4f6dc73aac9368cf3f4b2200eac4d4b4/src/equicordplugins/declutter); [Source](https://github.com/Equicord/Equicord/blob/e0e85c8d4f6dc73aac9368cf3f4b2200eac4d4b4/src/equicordplugins/questify/settings/store.ts)). Short matches on React keys such as `"nitro-tab-group"\)` needed fewer fixes than long `.{0,300}` spans.

CSS projects needed at least as much upkeep. Disblock Origin, the most complete list (639 lines, v1.6.0), had 69 commits after July 2025, and Discord-Adblock had 193 ([Source](https://codeberg.org/AllPurposeMat/Disblock-Origin/src/commit/76a96e7369fe95ed42cdb033d006357e9afd446b/DisblockOrigin.theme.css); [Source](https://codeberg.org/ridge/Discord-Adblock)). ChatButtonsBegone, the most active BetterDiscord plugin in this area (358 commits since July 2025), fixed its gift-button rule **nine times** between December 2025 and July 2026, and in January 2026 moved from hard-coded selectors to runtime webpack class lookups ([Source](https://github.com/LancersBucket/ChatButtonsBegone/commits/2ca0b8983220604e86a75083abd91f229635cd66); [Source](https://github.com/LancersBucket/ChatButtonsBegone/commit/73e96737c31303834e48b940338d4eaf64bc8bb7)). The gift button is the most fragile surface in every project; Disblock's gift selector once hid the Send button instead ([Source](https://codeberg.org/AllPurposeMat/Disblock-Origin/issues/100)). Less maintained lists stay broken for long periods: synthead's uBlock list fixed its `colorPremium-` rule twenty months after the 2023 format change and still has a `premiumFeatureBorder-` rule in the pre-2023 format ([Source](https://github.com/synthead/discord-adfree/commits/3877816b2cb8b9f7e20024728224d4a6144cc175)). Mainstream filter lists barely cover Discord. EasyList has one Discord rule, `discord.com#?#.wrapper__0d616:has-text(Get Reward)`, built on a full hashed class and English text, and it disables generic cosmetic filtering there with `@@||discord.com^$generichide`; AdGuard's Discord rules still use the pre-2023 class format ([Source](https://easylist.to/easylist/easylist.txt); [Source](https://filters.adtidy.org/extension/ublock/filters/14.txt)). None of these lists reach the desktop app unless the user runs an extension in it.

## Thirty upsell surfaces in build 634304, mapped to patches and selectors

On desktop, Discord's ads in late 2026 are Quest-family units labelled "Promoted": the Quest bar above the account panel, Quest Home and its hero banner, Active Now cards and quest embeds. Discord sells them through an auction-based Ads Manager announced on 29 September 2026, open to selected advertisers now and to all buyers in early 2027 ([Source](https://ppc.land/discord-opens-auction-priced-ad-buying-to-studios-of-any-size-by-early-2027/); [Source](https://support.discord.com/hc/en-us/articles/22225719947543-Discord-Quests-FAQ)). Partner promotions (outbound promotion nagbars, Gift Inventory promotions, partner perks) and "Promoted" App Directory listings make up the rest. No display ads or sponsored chat messages turned up in the client code. A desktop plugin cannot affect mobile placements, server-side targeting or measurement already recorded; Discord's only controls are the personalisation opt-out and a per-quest "Hide This" ([Source](https://support.discord.com/hc/en-us/articles/22225719947543-Discord-Quests-FAQ)).

Each patch anchor below was tested on 11 October 2026 by applying its `find` string and `match` regex, exactly as listed after the table, to the build-634304 module sources with the JavaScript regex engine ([Source](https://discord.com/assets/web.843cc7edc28c426c.js); [Source](https://discord.com/assets/93c6cc08f8c39193.js); [Source](https://discord.com/assets/af18456fa2e5d0a0.js)). Every `find` occurs in exactly one webpack module, and every `match` applies once there (twice for P3a, which uses `/g` on purpose). None has run in a live client yet. Intl-key finds were checked in hashed form (`EMOJI_PICKER_EXPAND_EMOJI_SECTION` → `NZI2Zk`, `EMOJI_CATEGORY_TOP_GUILD_EMOJI` → `W6Wi1X`, `PREMIUM_MESSAGE_LENGTH_UPSELL_TOOLTIP` → `BNAIBU`) with the xxhash64 scheme behind Vencord's `#{intl::KEY}` macro ([Source](https://github.com/Vendicated/Vencord/blob/dev/src/utils/intlHash.ts)). Module numbers apply to this build only. Declutter's Quests match applies to this build, and the keyboard-navigation array ends with `QUEST_HOME`, which Declutter leaves in place ([Source](https://discord.com/assets/web.843cc7edc28c426c.js)).

The Nitro-gated column decides whether a "hide only if I lack Nitro" option makes sense, and for the large surfaces it does not. The Nitro tab's visibility hook returns true for any account older than 14 days and has no "not premium" condition; the Shop and Quests rows render unconditionally; the Quest bar's only premium check hides some quests from people whose Nitro was bought outside Discord; the gift button checks the recipient, not the viewer ([Source](https://discord.com/assets/web.843cc7edc28c426c.js)). Subscribers also get Orbs-multiplier promotion ([Source](https://support.discord.com/hc/en-us/articles/30593690165783-Discord-Orbs-FAQ)). Picker and profile upsells appear to target only users without Nitro, judging by their class and string names; I did not trace them to `isPremium` calls.

| # | Surface | Technique | Exact `find` anchor or selector | Layout side effects | Nitro-gated? | Confidence |
|---|---|---|---|---|---|---|
| 1 | DM list: Nitro row | Patch P1, P2; CSS fallback | `tutorialId:"direct-messages"` (157667) and `.hasLibraryApplication()&&!` (176522); CSS `li:has(> div > a[href="/store"])` | Patch removes the row and its arrow-key stop; CSS leaves the arrow-key stop and the empty `nitro-tab-group` wrapper | No | High |
| 2 | DM list: Shop row | Patch P1, P2; CSS fallback | same finds; CSS `li:has(> div > a[href="/shop"])` | As row 1 | No | High |
| 3 | DM list: Quests row | Patch P1, P2; CSS fallback | same finds; CSS `li:has(> div > a[href="/quest-home"])` or `a[data-list-item-id$="___quests"]` | As row 1; the keyboard-list removal is new (Declutter misses it) | No | High |
| 4 | Quest bar above the account panel ("Promoted" ad slot) | Patch P3a and P3b; CSS fallback | `reason:"quest_bar_visible"` (518293) and `"useNoFillAd")` (lazy 663271); CSS `div:has(> [data-testid="quest-bar-container"])` | P3a makes `isQuestBarEmpty` true, so the account panel keeps rounded corners; CSS leaves square top corners from `containerQuestBarVisible_`. The ad decision is still fetched unless row 5 is on | No | Medium: verified, no maintenance history |
| 5 | All quest data (opt-in) | Patch P14 (`group`) | `type:"QUESTS_FETCH_CURRENT_QUESTS_BEGIN"` (396813) | Quest Home empties; Questify reports Orbs and Shop unaffected | No | Medium |
| 6 | Discover → Quests tab | Patch P10 | `GLOBAL_DISCOVERY_SIDEBAR},` (157667) | Tabs become Apps, Servers; `/quest-home` still opens by URL | No | Medium |
| 7 | Friends → Active Now quest promo | Patch P11 | `` `application-stream- `` (157667) | Card renders without the quest | No | Medium |
| 8 | Member list "playing a Quest" icon | Patch P12; CSS fallback | `("ActivityStatus"),` (394871); CSS `[class*="questsIcon_"]` inside the member list (two CSS files use the name) | None known | No | Medium |
| 9 | Quest and Orb profile badges (optional) | Patch P13 | `.MODAL]:26` (365607) | Also hides badges you earned | No | Medium |
| 10 | Quest Home hero and "Sponsored" tags, quest embeds in chat, Orbs menu icon | Visible by default; CSS opt-in | `[class*="sponsoredTag_"]`, `[class*="footerPromotedRow_"]`, `[class*="questEmbedCard_"]`, `[class*="orbUserStatusMenuIconWrapper_"]` | Hiding an embed leaves the message text; not observed | No | Low |
| 11 | Promotional nagbars (Nitro promo and marketing, trial and discount ending, gifting, Shop, Quest app, partner outbound promotion, checkout recovery) | Patch P6 with a type allowlist; CSS fallback | `.APP_NOTICE_VIEWED,` (157667); CSS `[class*="notice_"][class*="colorPremium"]` | NoticeStore keeps the hidden notice current, so a notice queued behind it waits (untested). Never filter `PREMIUM_MISSING_PAYMENT` or `PREMIUM_PAST_DUE_*` | Mostly non- and lapsed subscribers; partner promotions go to all | Medium |
| 12 | Coachmarks, popovers and "new" badges from the DC framework | Patch P7 (client-only); account-wide dismissal opt-in | `userContent?.dismissedContents);return` (595529) | Local only; other devices still show them | Mixed | Low: anchor verified, consumers untested, no prior art |
| 13 | Chat-bar gift button | Patch P5 | `"sticker")` (123583) | Remaining buttons close up (flex row) | No; Discord hides it itself under `2026-03-block-purchases` | Medium: verified, but the most-repaired rule everywhere |
| 14 | Message-length upsell | Patch P9 (same as core CharacterCounter); CSS for the inline card | `#{intl::PREMIUM_MESSAGE_LENGTH_UPSELL_TOOLTIP}` (625928); CSS `[class*="messageLengthUpsellContainer_"]` | None | Yes | High |
| 15 | Emoji picker Nitro-locked categories | Patch P8 (two patches) | `#{intl::EMOJI_PICKER_EXPAND_EMOJI_SECTION}),size:` (879064), `#{intl::EMOJI_CATEGORY_TOP_GUILD_EMOJI},{guildName:` (822123) | Data is filtered, so no gaps; do not use CSS on `categorySectionNitroLocked_` | Yes | High |
| 16 | Sticker, GIF and soundboard upsell banners | CSS | `[class*="emptyGuildUpsell_"]`, `[class*="nitroUpsell_"]`, `[class*="upsellHeaderContainer_"]`, `[class*="upsellBanner_"]` | Banners only; leave locked sections (`nitroLocked_`), which sit inside virtualised lists | Yes (by name) | Low |
| 17 | Super Reactions upsell | CSS | `[class*="burstReactionTooltipUpsellCta_"]` | Tooltip button only | Yes (by name) | Low |
| 18 | Profile customisation upsells ("Try It Out", display-name styles, decoration shop icons) | CSS on unique prefixes | `[class*="inlineUpsell_"]`, `[class*="premiumTryItOutSection_"]`, `[class*="upsellOverlayContainer_"]`; avoid bare `upsellContainer_` and `shopIcon_` | Not observed | Yes | Low |
| 19 | Appearance: theme and app-icon upsells | CSS | `[data-nav-anchor-key="appearance_custom_themes_upsell"]`, `[class*="bannerUpsell_"]`, `[class*="footerUpsellRow_"]` | Not observed | Yes | Medium |
| 20 | Nitro offer and trial counts and badges | Core NoPendingCount for counts; CSS for badges | `showProgressBadge:` (502239); CSS `[class*="premiumOfferUnackedBadge_"]` | None | Non-subscribers | Medium |
| 21 | File-size upsell modal | Leave | n/a | CSS on a modal leaves its focus lock and blocks the app; the modal also reports a real error | Yes | n/a |
| 22 | Settings → Nitro | CSS, applied only when the user has no subscription | `li[data-settings-sidebar-item="nitro_panel"]` | Subscribers would lose "Manage Subscription" | No | Medium |
| 23 | Settings → Gift Inventory partner promotions | CSS | `[class*="promotionCard_"]` | None | No | Medium |
| 24 | Settings → Subscriptions and Billing | Keep visible | n/a | Declutter removes Billing by default; impede should not | n/a | n/a |
| 25 | Boost progress bar in the channel list | Patch P4; CSS fallback | `useGuildActionRow` (144888); CSS `[--boostBar]` filled from `findCssClassesLazy("container","progressContainer","boostCountText")` | Patch also skips the divider special case; CSS leaves it | No; per-server admin setting | High |
| 26 | "Server Boosts" channel-list row | Patch P4; CSS fallback | `useGuildActionRow` (144888); CSS `li:has([id^="skill-trees-"])` | Admins lose a shortcut to the boost perks page | No | Medium |
| 27 | Server dropdown "Server Boost" item | Context-menu patch C1; CSS fallback | navId `guild-header-popout`, item id `premium-subscribe`; CSS `#guild-header-popout-premium-subscribe` | The item's group may be left empty with its separator | No | Medium |
| 28 | Boost coachmarks and banners (`BOOST_*`, `FIRST_BOOSTER_UPSELL`, `GUILD_BOOST_TAB_*`) | Patch P7 | as row 12 | as row 12 | No | Low |
| 29 | Settings → Server Boost | CSS, opt-in, off by default | `li[data-settings-sidebar-item="premium_guild_subscriptions_panel"]` | Also hides boost-slot management | No | Medium |
| 30 | App Directory "Promoted" listings, Activities shelf | Not mapped | module 869362 only | n/a | No | n/a |

The patch set, with Equicord and Vencord origins marked for attribution:

```ts
// Verified against Discord stable 634304 (2026-10-09). P1, P2, P5, P8: after Equicord Declutter;
// P10-P14: after Equicord Questify; P9: Vencord CharacterCounter. All GPL-3.0-or-later.
const s = () => settings.store;

patches: [
    {   // P1: DM-list rows (module 157667)
        find: 'tutorialId:"direct-messages"',
        replacement: [
            { match: /"nitro-tab-group"\)/, replace: "$&&&undefined", predicate: () => s().dmNitro },
            { match: /NAVIGATION_LINK\}\}\},"discord-shop"\)/, replace: "$&&&undefined", predicate: () => s().dmShop },
            { match: /\.QUEST_HOME\)\},"quests"\)/, replace: "$&&&undefined", predicate: () => s().dmQuests },
        ],
    },
    {   // P2: keyboard-navigation list for the same rows (module 176522); the array is .filter(x => x != null)
        find: ".hasLibraryApplication()&&!",
        replacement: [
            { match: /\i\.\i\.APPLICATION_STORE,/, replace: "", predicate: () => s().dmNitro },
            { match: /\i\.\i\.COLLECTIBLES_SHOP,/, replace: "", predicate: () => s().dmShop },
            { match: /\i\.\i\.QUEST_HOME(?=\]\.filter)/, replace: "null", predicate: () => s().dmQuests },
        ],
    },
    {   // P3a: Quest bar visibility (module 518293); also makes isQuestBarEmpty true
        find: 'reason:"quest_bar_visible"',
        predicate: () => s().questBar,
        replacement: { match: /(?<=\{isQuestBarVisible:)!0(?=,reason:"quest_bar_visible"\})/g, replace: "!1" },
    },
    {   // P3b: QuestBar root (lazy module 663271); covers QUEST, BOUNTY and NO_FILL creatives
        find: '"useNoFillAd")',
        predicate: () => s().questBar,
        replacement: { match: /(?=switch\(\i\.type\)\{case \i\.\i\.QUEST:\{let\{quest:)/, replace: "return null;" },
    },
    {   // P4: channel-list action rows (module 144888)
        find: "useGuildActionRow",
        replacement: [
            { match: /(?=\i\.push\(\i\.\i\.GUILD_PREMIUM_PROGRESS_BAR\))/, replace: "false&&", predicate: () => s().boostBar },
            { match: /(?=\i\.push\(\i\.\i\.GUILD_BOOSTS\))/, replace: "false&&", predicate: () => s().boostRow },
        ],
    },
    {   // P5: chat-bar gift button (module 123583)
        find: '"sticker")',
        predicate: () => s().giftButton,
        replacement: { match: /&&\i\.push\(\([^&]*?,"gift"\)\)/, replace: "" },
    },
    {   // P6: promotional notices (module 157667)
        find: ".APP_NOTICE_VIEWED,",
        predicate: () => s().nagbars,
        replacement: { match: /(?<=\(\)=>)\i\.getNotice\(\)/, replace: "$self.filterNotice($&)" },
    },
    {   // P7: dismissible-content candidates (module 595529); client-side only, writes nothing
        find: "userContent?.dismissedContents);return",
        predicate: () => s().coachmarks,
        replacement: { match: /(?<=dismissedContents\);return \i\.filter\()(\i)=>/, replace: "$1=>!$self.isSuppressedDC($1)&&" },
    },
    {   // P8: Nitro-locked emoji (modules 879064, 822123)
        find: "#{intl::EMOJI_PICKER_EXPAND_EMOJI_SECTION}),size:",
        predicate: () => s().lockedEmoji,
        replacement: { match: /(\i)=\i\|\|!\i&&\i\.\i\.isEmojiCategoryNitroLocked\(\{[^}]*\}\);/, replace: "$&$1||" },
    },
    {
        find: "#{intl::EMOJI_CATEGORY_TOP_GUILD_EMOJI},{guildName:",
        predicate: () => s().lockedEmoji,
        replacement: { match: /(?<=(\i)\.unshift\((\i)\):)(?=\1\.push\(\2\))/, replace: "$2.isNitroLocked||" },
    },
    {   // P9: message-length upsell tooltip (module 625928)
        find: "#{intl::PREMIUM_MESSAGE_LENGTH_UPSELL_TOOLTIP}",
        predicate: () => s().messageLength,
        replacement: { match: /(?<=\.PREMIUM_UPSELL\);)(?=.{0,50}\.PREMIUM_UPSELL_VIEWED)/, replace: "return null;" },
    },
    {   // P10: Discover -> Quests tab (module 157667); GLOBAL_DISCOVERY_TABS is ["apps","servers","quests"]
        find: "GLOBAL_DISCOVERY_SIDEBAR},",
        predicate: () => s().discoverQuests,
        replacement: { match: /(GLOBAL_DISCOVERY_TABS)\.map/, replace: '$1.filter(t=>t!=="quests").map' },
    },
    {   // P11: Active Now quest promo (module 157667)
        find: "`application-stream-",
        predicate: () => s().activeNowQuest,
        replacement: { match: /(?<=let\{party:\i,onChannelContextMenu:\i,)quest:(\i)/, replace: "impedeNoQuest:$1=null" },
    },
    {   // P12: member-list quest icon (module 394871)
        find: '("ActivityStatus"),',
        predicate: () => s().memberQuestIcon,
        replacement: { match: /,hasQuest:(?=\i=!1)/, replace: ",impedeNoQuest:" },
    },
    {   // P13: quest and Orb profile badges (module 365607), optional
        find: ".MODAL]:26",
        predicate: () => s().questBadges,
        replacement: {
            match: /(,\{badges:\i)(?=,overflowCount:\i,displayProfile:\i)/,
            replace: '$1.filter(b=>!["quest_completed","orb_profile_badge"].includes(b.id))',
        },
    },
    {   // P14: stop fetching quests (module 396813), opt-in
        find: 'type:"QUESTS_FETCH_CURRENT_QUESTS_BEGIN"',
        group: true,
        predicate: () => s().noQuestFetch,
        replacement: [
            { match: /(?<=if\(\i\.\i\.isFetchingCurrentQuests)/, replace: "||true" },
            { match: /(?=let \i=Date\.now\(\);\i\.recordQuestRequestAttempt.{0,50}QUESTS_FETCH_QUEST_TO_DELIVER_BEGIN)/, replace: "return;" },
        ],
    },
],
```

The helpers referenced by P6 and P7, and the context-menu patch C1. Notice type values equal their names in this build (`T.PREMIUM_PROMO="PREMIUM_PROMO"`), and the DC enum is a numeric enum that `findByPropsLazy` can reach because Vencord's finders search nested exports ([Source](https://github.com/Vendicated/Vencord/blob/dev/src/webpack/webpack.ts)). The context-menu API is the one four core plugins already use on `guild-header-popout`, among them serverInfo ([Source](https://github.com/Vendicated/Vencord/blob/dev/src/plugins/serverInfo/index.tsx); [Source](https://github.com/Vendicated/Vencord/blob/dev/src/api/ContextMenu.ts)). In this build Discord renders that menu in three migration variants (`data-menu-migrated-auto`, `data-menu-migrated`, `data-menu-needs-review`), so test all of them ([Source](https://discord.com/assets/d748014cc49ca548.js)).

```ts
// P6: nagbars to drop. Payment problems (PREMIUM_MISSING_PAYMENT, PREMIUM_PAST_DUE_*) and
// PREMIUM_UNCANCEL (state of the user's own subscription) stay visible.
const PROMO_NOTICES = new Set([
    "PREMIUM_PROMO", "PREMIUM_MARKETING_NAGBAR", "PREMIUM_TIER_0_TRIAL_ENDING", "PREMIUM_TIER_2_TRIAL_ENDING",
    "PREMIUM_TIER_2_DISCOUNT_ENDING", "PREMIUM_REACTIVATE", "LOCALIZED_PRICING", "GIFTING_PROMOTION_REMINDER",
    "COLLECTIBLES_SHOP_NAGBAR", "COD_3PP_NAGBAR", "YOUTUBE_3P_NAGBAR", "QUEST_APP_UPSELL", "OUTBOUND_PROMOTION",
    "DETECTED_OFF_PLATFORM_PREMIUM_PERK_UPSELL", "CHECKOUT_RECOVERY_NAGBAR", "VOICE_DARE_OFFER",
]);

// P7: explicit names, never a regex over the enum (a regex also catches onboarding tips).
const DCEnum = findByPropsLazy("DISMISSIBLE_CONTENT_UNSPECIFIED", "QUEST_HOME_NEW_QUEST_BADGE");
const SUPPRESSED_DC_NAMES = [
    "NAGBAR_NOTICE_PREMIUM_PROMO", "PREMIUM_MARKETING_MOMENT_NAGBAR_UPSELL", "PREMIUM_SHOP_NAGBAR_NOTICE",
    "NAGBAR_QUEST_APP_UPSELL", "THIRD_PARTY_OUTBOUND_PROMO_NAGBAR", "GIFTING_PROMOTION_REMINDER",
    "PREMIUM_SUBSCRIPTION_UPSELL_EMOJI_PICKER_TOP_OF_LIST", "NITRO_FILE_UPLOAD_1GB_UPSELL",
    "MONTHLY_TO_YEARLY_UPSELL_STICKY_BAR", "REFERRAL_PROGRAM_POPOVER_V2", "NITRO_TAB_QUEST_ORB_MULTIPLIER_TOOLTIP",
    "COLLECTIBLES_SHOP_ENTRY_MARKETING", "USER_PROFILE_PREMIUM_AND_SHOP_ENTRY_POINTS", "GIFTING_INTENT_FRIENDS_TAB_BADGE",
    "QUEST_HOME_ENTRYPOINT_HERO_BADGE", "QUEST_HOME_NEW_QUEST_BADGE", "PREMIUM_ORBS_UPSELL_POPOVER",
    "ORB_WALLET_NITRO_UPSELL_CTA_CARD", "BOOST_PROGRESS_BAR_MEMBER_COACHMARK", "BOOST_TO_UNLOCK_COACHMARK",
    "FIRST_BOOSTER_UPSELL", "GUILD_BOOST_TAB_BANNER", "GUILD_BOOST_TAB_HIGHLIGHT",
];
let suppressedDCs: Set<number> | null = null;

// inside definePlugin({...}):
filterNotice(notice: any) {
    return notice != null && PROMO_NOTICES.has(notice.type) ? null : notice;
},
isSuppressedDC(id: number) {
    try {
        suppressedDCs ??= new Set(SUPPRESSED_DC_NAMES.map(n => DCEnum[n]).filter(v => typeof v === "number"));
        return suppressedDCs.has(id);
    } catch {
        return false;
    }
},
contextMenus: {
    // C1: drop "Server Boost" from the server dropdown
    "guild-header-popout"(children) {
        if (!settings.store.boostMenuItem) return;
        const group = findGroupChildrenByChildId("premium-subscribe", children);
        const i = group?.findIndex(c => c?.props?.id === "premium-subscribe") ?? -1;
        if (i !== -1) group!.splice(i, 1);
    },
},
```

The fallback and long-tail stylesheet. Split it into one `?managed` file per setting group so each can be switched with `enableStyle` and `disableStyle` from its setting's `onChange`:

```css
/* DM-list rows: fallback for P1/P2 only (keyboard focus still reaches hidden rows) */
li:has(> div > a[href="/store"]),
li:has(> div > a[href="/shop"]),
li:has(> div > a[href="/quest-home"]) { display: none; }

/* Quest bar fallback (account panel keeps square top corners) */
div:has(> [data-testid="quest-bar-container"]) { display: none; }

/* Nitro-styled nagbars; P6 is preferred */
[class*="notice_"][class*="colorPremium"] { display: none; }

/* Inline Nitro banners */
[class*="messageLengthUpsellContainer_"],
[class*="emptyGuildUpsell_"],
[class*="nitroUpsell_"],
[class*="upsellHeaderContainer_"],
[class*="upsellBanner_"],
[class*="burstReactionTooltipUpsellCta_"],
[class*="inlineUpsell_"],
[class*="premiumTryItOutSection_"],
[class*="upsellOverlayContainer_"],
[class*="premiumOfferUnackedBadge_"] { display: none; }

/* Appearance settings */
[data-nav-anchor-key="appearance_custom_themes_upsell"],
[class*="bannerUpsell_"],
[class*="footerUpsellRow_"] { display: none; }

/* Settings: partner promotions always; Nitro panel only for users with no subscription */
[class*="promotionCard_"] { display: none; }
li[data-settings-sidebar-item="nitro_panel"] { display: none; }

/* Server Boost fallbacks; [--boostBar] is filled by setStyleClassNames at start() */
[--boostBar] { display: none; }
li:has([id^="skill-trees-"]) { display: none; }
#guild-header-popout-premium-subscribe { display: none; }
```

Test the whole set on every Discord build. Vencord's reporter CI runs only in the upstream repository, but its build glob includes `src/userplugins`, so `pnpm buildReporter` followed by `scripts/generateReport.ts` with `CHROMIUM_BIN` set checks impede's patches locally against logged-out `discord.com/login` ([Source](https://github.com/Vendicated/Vencord/blob/dev/.github/workflows/reportBrokenPlugins.yml); [Source](https://github.com/Vendicated/Vencord/blob/dev/scripts/generateReport.ts)). For the stylesheet, a dev-only check that counts how many nodes each selector matches on the relevant screens is the only warning available. On Equicord with Declutter enabled, impede's P1 regexes should still match, because Declutter only appends `&&undefined` after the same text, but P2's Nitro and Shop matches will report "had no effect" because Declutter has already removed those entries (reasoned from the patch text, not tested). Users should enable one plugin or the other for those rows.

## Discord punishes quest automation; hiding UI has no recorded enforcement

Any Vencord plugin breaks Discord's Terms. They forbid "using any unauthorized software designed to modify the services" and say "You also may not reverse engineer or decompile our software" ([Source](https://discord.com/terms)), and the platform manipulation policy adds "Making modifications to the Discord client for the purpose of spam or any other reason is not allowed under this policy" ([Source](https://discord.com/safety/platform-manipulation-policy-explainer)). Writing patch regexes against the minified bundle is reverse engineering in the Terms' sense. Vencord's README says "there are no known cases of users getting banned for using client mods" as long as plugins avoid abusive behaviour ([Source](https://github.com/Vendicated/Vencord/blob/dev/README.md)), and none of the sources reviewed here record enforcement against UI hiding. impede adds little to the exposure a Vencord user already has.

Discord can probably see that a mod is present whatever impede does. Its pre-app `fast-connect` script checks for `window.Vencord`, `window.VencordNative`, `window.BetterDiscord` and similar globals and sends the result as `has_client_mods` in the client properties; the main bundle adds `uses_client_mods` to heartbeat analytics, and Sentry drops error reports from modded clients ([Source](https://discord.com/assets/fast-connect.d9d679519c7143d6.js); [Source](https://discord.com/assets/web.843cc7edc28c426c.js)). Vencord's required NoTrack plugin makes the main-bundle check return false, but `fast-connect` is not a webpack module and cannot be patched that way ([Source](https://github.com/Vendicated/Vencord/blob/dev/src/plugins/_core/noTrack.ts)). Whether `window.Vencord` exists before `fast-connect` runs was not verified. What impede can control is the traffic it adds or removes. CSS and render patches send nothing new. P7 writes nothing to the account. Account-wide DC dismissal sends the same settings write a user's click would, and should be batched into one `updateAsync("userContent", …)` after `CONNECTION_OPEN`. Otherwise Discord logs a `DISMISSIBLE_CONTENT_DISMISSED_BEFORE_CONNECTION_OPEN` event ([Source](https://discord.com/assets/web.843cc7edc28c426c.js)). P14 removes quest requests entirely, which Discord can observe; no source links that to any penalty. The Nitro override can produce repeated failed requests when the client attempts Nitro-only actions. CSS hiding leaves the Quest bar's ad decision fetch and its impression wrapper running, so a CSS-only user can register ad views they never saw; P3b returns before the component that receives `adCreativeId` mounts (read from the code, not traced to a network call).

Quest automation is where enforcement exists. Questify's in-plugin notices, dated 7 and 26 August 2026, say "Discord has begun punishing users of scripts and plugins that modify the completion of Quests" and that the punishment includes "an account standing violation which lasts 2 years per violation" ([Source](https://github.com/Equicord/Equicord/blob/e0e85c8d4f6dc73aac9368cf3f4b2200eac4d4b4/src/equicordplugins/questify/settings/notices.tsx)). The client's `QuestStore` has `questAccessSuspendedUntil` and `isQuestAccessSuspended`, and Discord attaches `stack_trace: Error().stack` to quest video-progress and heartbeat requests, which Questify strips ([Source](https://discord.com/assets/web.843cc7edc28c426c.js); [Source](https://github.com/Equicord/Equicord/blob/e0e85c8d4f6dc73aac9368cf3f4b2200eac4d4b4/src/equicordplugins/questify/index.tsx)). I found no official Discord statement on quest bans; the evidence is that client field and third-party reports. impede should therefore never post quest progress, heartbeats or enrolments, never alter `stack_trace`, never claim rewards, never call the per-quest dismiss endpoint in bulk, and never import any of Questify's completion code, even though that code is licence-compatible. Vencord's own rules also forbid "selfbots or API spam" ([Source](https://github.com/Vendicated/Vencord/blob/dev/CONTRIBUTING.md)). If impede is ever offered upstream, Vencord requires that "All AI usage in any form must be disclosed", and its AGENTS.md tells AI agents never to open issues or pull requests ([Source](https://github.com/Vendicated/Vencord/blob/16ec4ea838899706019e7f472e45f055070abeb1/CONTRIBUTING.md); [Source](https://github.com/Vendicated/Vencord/blob/dev/AGENTS.md)).

On licensing, impede is AGPL-3.0-or-later and is compiled inside Vencord's GPL-3.0-or-later tree ([Source](https://github.com/Vendicated/Vencord/blob/dev/LICENSE)). AGPL-3.0 §13 grants "permission to link or combine any covered work with a work licensed under version 3 of the GNU General Public License into a single combined work", and adds that "the work with which it is combined will remain governed by version 3 of the GNU General Public License" ([Source](https://www.gnu.org/licenses/agpl-3.0.html)). Patches copied from Vencord or Equicord can therefore ship in impede, but they stay under GPLv3 and should keep a comment crediting their origin. Permissive code (MIT, Unlicense) can be included with its notice. Code with no licence cannot be copied, though the Discord attributes it targets are facts anyone can use. §10 of the same licence says "You may not impose any further restrictions on the exercise of the rights granted", which excludes Discord-Adblock's added non-AI condition ([Source](https://www.gnu.org/licenses/agpl-3.0.html)). Two licences differ from what the repositories' front pages suggest: Disblock Origin's `.user.css` declares `@license MIT` in its header although the repository has no LICENSE file, and the vencord-no-more-quests userplugin has a GPL-3.0-or-later SPDX header ([Source](https://codeberg.org/AllPurposeMat/Disblock-Origin/src/commit/76a96e7369fe95ed42cdb033d006357e9afd446b/DisblockOrigin.user.css); [Source](https://github.com/jordanw0204-rgb/vencord-no-more-quests/blob/6755e05783ef80f8a59a1a4aee98a8ff42c228a6/index.ts)).

| Source | Licence as found | Use in impede |
|---|---|---|
| Vencord core (APIs, CharacterCounter, NoPendingCount, NoTrack) | GPL-3.0-or-later ([Source](https://github.com/Vendicated/Vencord/blob/dev/LICENSE)) | Reuse; copied parts stay GPLv3 under AGPL §13; credit in comments |
| Equicord: Declutter, Questify hiding patches, NoNitroUpsell | GPL-3.0-or-later ([Source](https://github.com/Equicord/Equicord/blob/e0e85c8d4f6dc73aac9368cf3f4b2200eac4d4b4/LICENSE)) | Reuse with credit to the plugin authors. Do not copy Questify's completion or stack-trace code, for account-safety reasons |
| mdga | GPL-3.0-or-later ([Source](https://github.com/BxdiS/mdga/tree/bdad2677a914ba93f1bebace0d03371b822f3efd)) | Compatible; its XHR and route guards are not recommended |
| moonlight-extensions noNitroUpsell | GPL-3.0 ([Source](https://github.com/Enovale/moonlight-extensions/tree/16fdf67d37f00b423655cafc20d5d8f8ce5dd265)) | Compatible |
| Tolerable Discord | GPL-3.0-only on AMO; no licence file in the repository ([Source](https://addons.mozilla.org/en-US/firefox/addon/tolerable-discord/)) | Compatible if AMO is correct; confirm before copying |
| vencord-no-more-quests | SPDX GPL-3.0-or-later header; no LICENSE file | Compatible on the header; its fetch wrapping and DOM observer are not recommended |
| ChatButtonsBegone | Unlicense ([Source](https://github.com/LancersBucket/ChatButtonsBegone/tree/2ca0b8983220604e86a75083abd91f229635cd66)) | Compatible |
| NoThanksDiscord, D3SOX hide-nitro-upselling, Replugged no-nitro-upsell | MIT ([Source](https://github.com/tony-nz/NoThanksDiscord/blob/1f61ae57221959618a8859fddec22f404e575b45/NoThanksDiscord.plugin.js)) | Compatible; keep the MIT notice |
| ChromanicAI DiscordAnnoyanceRemoval | `@license MIT` in the userstyle header; no LICENSE file ([Source](https://github.com/ChromanicAI/DiscordAnnoyanceRemoval/blob/ab9f4f0bc2e84f57cfb10592c7ba5e996a1ea9d4/style.user.css)) | Compatible on the header; credit it |
| Disblock Origin | `@license MIT` in `DisblockOrigin.user.css` only; `.theme.css` has none; no LICENSE file or copyright line | Unclear. Prefer writing selectors from Discord's DOM; if text is copied, take it from the `.user.css` and credit "TheSunCat and contributors" |
| synthead/discord-adfree, heyimby/No-Quests, brewffee/DiscordHideExtraBadges, cvyl/HideQuests | None ([Source](https://github.com/synthead/discord-adfree/blob/3877816b2cb8b9f7e20024728224d4a6144cc175/discord-adfree.txt)) | Do not copy; the attributes they target are usable facts |
| Discord-Adblock | 0-Clause BSD NON-AI ([Source](https://codeberg.org/ridge/Discord-Adblock/src/commit/30bda79edc95462ba9827c2bef702947876dc3d5/LICENSE)) | Do not copy, and do not give it to AI tools: it bars use "related to artificial intelligence ... including but not limited to code generation", and that condition conflicts with AGPL §10 |
| Discord's client code | Proprietary; the Terms bar reverse engineering | Patch matches quote minified fragments; keep them small and free of minified variable names, as Vencord's docs advise ([Source](https://github.com/Vencord/Docs/blob/main/src/content/docs/plugins/patches.mdx)) |

## Conclusion

The anchors that last are strings Discord needs for its own purposes: React list keys (`"nitro-tab-group"`, `"gift"`), route and action-row enums (`QUEST_HOME`, `GUILD_PREMIUM_PROGRESS_BAR`), flux action types and analytics reason strings (`reason:"quest_bar_visible"`). Minified names and DOM structure do not last. Declutter's record suggests impede will need a regex fix somewhere most months, mostly in the gift button and the DM-list matches, while each `find` string can be expected to last years. The reporter run locally on each Discord build will name the patch that failed; a stale CSS rule gives no such signal. That difference is the practical reason to put the default behaviour in patches and leave CSS as a fallback.

Two parts of the design rest on assumptions to check early in a running client. The first is the client-side DC filter (P7): if Discord's coachmarks and popovers take their candidates through that one function, a single patch handles campaign promotions that neither CSS nor named patches can track, including ones Discord has not shipped yet. The second is the Quest bar, which Discord is turning into a general ad slot. This build already routes `BOUNTY` and `NO_FILL` creatives through the same component, and the `2026-10-bounties-desktop-quest-bar` experiment is in the bundle ([Source](https://discord.com/assets/web.843cc7edc28c426c.js)). P3b returns before that component's type switch, so it will keep covering new creative types that P3a's quest-only visibility check would miss.
