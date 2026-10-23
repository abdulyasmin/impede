/*
 * impede, a Vencord plugin that hides Discord ads and upsells
 * Copyright (c) 2026 yasmin
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// Patches P1, P2, P5 and P8 are adapted from Equicord's Declutter, P10-P14 from Equicord's
// Questify, and P9 from Vencord's CharacterCounter. Those projects are GPL-3.0-or-later;
// AGPL-3.0 section 13 permits the combination, and the adapted parts stay under the GPL.
// Every patch was checked against Discord stable build 647615 (2026-10-23).

import { findGroupChildrenByChildId } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import { managedStyleRootNode } from "@api/Styles";
import { createAndAppendStyle } from "@utils/css";
import { getIntlMessage, getIntlMessageFromHash } from "@utils/discord";
import definePlugin, { OptionType } from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { UserStore } from "@webpack/common";

const needsRestart = (description: string, enabled = true) => ({
    type: OptionType.BOOLEAN as const,
    description,
    default: enabled,
    restartNeeded: true,
    onChange: updateStyle,
});

const live = (description: string, enabled = true) => ({
    type: OptionType.BOOLEAN as const,
    description,
    default: enabled,
    onChange: updateStyle,
});

const settings = definePluginSettings({
    // Quests (Discord's ad format)
    dmQuests: needsRestart("Hide the Quests row in the DM list"),
    questBar: needsRestart("Hide the sponsored Quest bar above the account panel"),
    discoverQuests: needsRestart("Hide the Quests tab in Discover"),
    activeNowQuest: needsRestart("Hide Quest promos on Active Now cards"),
    memberQuestIcon: needsRestart("Hide the 'playing a Quest' icon in the member list"),
    questEmbeds: live("Hide Quest embeds in chat and the Orbs icon in the status menu"),
    questBadges: needsRestart("Hide Quest and Orb profile badges, including ones you earned", false),
    blockQuestFetch: needsRestart("Stop the client from fetching Quests at all (Discord can see the missing requests)", false),

    // Nitro and Shop
    dmNitro: needsRestart("Hide the Nitro row in the DM list"),
    dmShop: needsRestart("Hide the Shop row in the DM list"),
    giftButton: needsRestart("Hide the gift button in the chat bar"),
    nagbars: needsRestart("Hide promotional notice bars at the top of the app (payment problems stay visible)"),
    coachmarks: needsRestart("Hide Nitro, Shop, Quest and Boost coachmarks, popovers and 'new' badges"),
    lockedEmoji: needsRestart("Hide emoji, stickers and sounds you need Nitro to use"),
    messageLength: needsRestart("Hide the Nitro upsell when a message is too long"),
    subscribeButtons: needsRestart("Remove 'Get Nitro' and 'Subscribe' buttons everywhere when you have no subscription"),
    expressionUpsells: needsRestart("Remove Nitro upsells from emoji, sticker, sound and Super Reaction popouts and pickers"),
    profileUpsells: needsRestart("Remove Nitro and Shop upsells from profiles, the profile editor and the decoration pickers"),
    wishlists: needsRestart("Hide Shop wishlists on profiles (also removes gifting from a friend's wishlist)"),
    nitroPopups: needsRestart("Remove other Nitro upsells: streaming, uploads, server and group-DM limits, scheduled messages, settings, Orbs and Quest rewards"),
    inlineUpsells: live("Hide Nitro banners in pickers, profiles, reactions and appearance settings"),
    giftPromotions: needsRestart("Hide partner promotions in Settings → Gift Inventory and friend-anniversary gift prompts"),
    nitroSettings: live("Hide Settings → Nitro when you have no subscription"),

    // Server Boost
    boostBar: needsRestart("Hide the boost progress bar in the channel list"),
    boostRow: needsRestart("Hide the 'Server Boosts' row in the channel list"),
    boostMenuItem: live("Hide 'Server Boost' in the server dropdown menu"),
    boostSettings: live("Hide Settings → Server Boost (also hides boost-slot management)", false),
});

type SettingKey = keyof typeof settings.store;

// Fallbacks for the patched surfaces, plus inline upsells that have no stable code anchor.
// Routing and test attributes have survived Discord's class-name changes; [class*="name_"]
// matches both suffix shapes (name_abc123, name__0abcd) but breaks without warning.
const HIDE_SELECTORS: Partial<Record<SettingKey, string[]>> = {
    dmQuests: ['li:has(> div > a[href="/quest-home"])'],
    questBar: ['div:has(> [data-testid="quest-bar-container"])'],
    questEmbeds: ['[class*="questEmbedCard_"]', '[class*="orbUserStatusMenuIconWrapper_"]'],
    dmNitro: ['li:has(> div > a[href="/store"])'],
    dmShop: ['li:has(> div > a[href="/shop"])'],
    // Keep payment warnings and subscription notices visible even if Discord adds wrappers.
    nagbars: ['[class*="notice_"][class*="colorPremium"]:not([class*="colorWarning"]):not([class*="colorDanger"]):not(:has([class*="premiumIcon_"]))'],
    coachmarks: ['[data-mana-component="popover"]:has(> [class*="nitro-pink_"])'],
    messageLength: ['[class*="messageLengthUpsellContainer_"]'],
    subscribeButtons: [
        'button:has(> [class*="premiumSubscribeButton_"])',
        // The Nitro wheel icon; it also marks a few subscriber-only buttons, so this rule is
        // dropped for subscribers along with the patches.
        'button[data-mana-component="button"]:has(path[d^="M16.23 12c0 1.29-.95 2.25-2.22 2.25"])',
    ],
    expressionUpsells: [
        '[class*="upsellContainerFloating_"]',
        '[class*="upsellContainerInline_"]',
        ':is([class*="emojiSection_"], [class*="otherEmojisContainer_"]) [class*="ctaButton_"]:has(svg)',
        '[class*="burstReactionTooltipPrompt_"]:has([aria-label="super reaction tooltip upsell"])',
        '[class*="upsellWrapper_"]',
        '[class*="upsellOuter_"]',
        '[class*="infoNitroContainer_"]',
    ],
    profileUpsells: [
        'aside[class*="upsellContainer_"]',
        "#user-profile-overflow-menu-shop-this-look",
        "#user-profile-overflow-menu-referral-profile-share-nitro",
        '[class*="contentWithUpsell_"] > [class*="nitro-pink_"]',
        '[class*="guildProfileUpsell_"]',
        '[class*="tryItOutSection_"]',
        '[class*="floatingNitroUpsell_"]',
        '[class*="nitroUpsellContainer_"]',
        '[class*="upsell_"]:has(> [class*="descriptionContainer_"] + [class*="buttonContainer_"])',
    ],
    nitroPopups: [
        '[class*="upsellRibbonContainer_"]',
        '[class*="premiumOptionContainer_"] > svg',
        '[role="list"]:has(> [role="listitem"] > [class*="premiumOption_"])',
        '[class*="premiumStreamIcon_"]',
        '[class*="tryItOutButtons_"] > :not(:first-child)',
        '[class*="experimentUpsellError_"]',
        '[class*="nitroUpsellBannerOverlay_"]',
        '[data-testid="contextual-referral-embed-card"]',
        '[class*="nitroBadge_"]',
        'div:has(> div > [class*="nitroBadge_"]) > [class*="buttonContainer_"]',
        '[class*="upsellBar_"]',
    ],
    inlineUpsells: [
        '[class*="emptyGuildUpsell_"]',
        '[class*="nitroUpsell_"]',
        '[class*="upsellHeaderContainer_"]',
        '[class*="upsellBanner_"]',
        '[class*="burstReactionTooltipUpsellCta_"]',
        '[class*="inlineUpsell_"]',
        '[class*="premiumTryItOutSection_"]',
        '[class*="upsellOverlayContainer_"]',
        '[class*="premiumOfferUnackedBadge_"]',
        '[data-nav-anchor-key="appearance_custom_themes_upsell"]',
        '[class*="bannerUpsell_"]',
        '[class*="footerUpsellRow_"]',
    ],
    giftPromotions: ['[class*="promotionCard_"]', '[class*="promoHeaderContainer_"]', '[class*="friendAnniversaryRow_"]'],
    nitroSettings: ['li[data-settings-sidebar-item="nitro_panel"]'],
    boostRow: ['li:has([id^="skill-trees-"])'],
    boostMenuItem: ["#guild-header-popout-premium-subscribe"],
    boostSettings: ['li[data-settings-sidebar-item="premium_guild_subscriptions_panel"]'],
};

// Settings whose CSS is skipped for subscribers, who need the page and buttons it hides.
const SUBSCRIBER_EXEMPT = new Set<SettingKey>(["nitroSettings", "subscribeButtons"]);

// Notice types skipped by P6. Payment problems (PREMIUM_MISSING_PAYMENT, PREMIUM_PAST_DUE_*)
// and PREMIUM_UNCANCEL describe the user's own subscription, so they stay.
const PROMO_NOTICES = new Set([
    "PREMIUM_PROMO", "PREMIUM_MARKETING_NAGBAR", "PREMIUM_TIER_0_TRIAL_ENDING", "PREMIUM_TIER_2_TRIAL_ENDING",
    "PREMIUM_TIER_2_DISCOUNT_ENDING", "PREMIUM_REACTIVATE", "LOCALIZED_PRICING", "GIFTING_PROMOTION_REMINDER",
    "COLLECTIBLES_SHOP_NAGBAR", "COD_3PP_NAGBAR", "YOUTUBE_3P_NAGBAR", "QUEST_APP_UPSELL", "OUTBOUND_PROMOTION",
    "DETECTED_OFF_PLATFORM_PREMIUM_PERK_UPSELL", "CHECKOUT_RECOVERY_NAGBAR", "VOICE_DARE_OFFER",
]);

// Dismissible-content units dropped by P15. Listed by name, because a pattern over the
// enum would also catch onboarding tips. Nothing is written to the account.
const DismissibleContent = findByPropsLazy("DISMISSIBLE_CONTENT_UNSPECIFIED", "QUEST_HOME_NEW_QUEST_BADGE");
const SUPPRESSED_DC_NAMES = [
    "NAGBAR_NOTICE_PREMIUM_PROMO", "PREMIUM_MARKETING_MOMENT_NAGBAR_UPSELL", "PREMIUM_SHOP_NAGBAR_NOTICE",
    "NAGBAR_QUEST_APP_UPSELL", "THIRD_PARTY_OUTBOUND_PROMO_NAGBAR", "GIFTING_PROMOTION_REMINDER",
    "PREMIUM_SUBSCRIPTION_UPSELL_EMOJI_PICKER_TOP_OF_LIST", "NITRO_FILE_UPLOAD_1GB_UPSELL",
    "MONTHLY_TO_YEARLY_UPSELL_STICKY_BAR", "REFERRAL_PROGRAM_POPOVER_V2", "NITRO_TAB_QUEST_ORB_MULTIPLIER_TOOLTIP",
    "COLLECTIBLES_SHOP_ENTRY_MARKETING", "USER_PROFILE_PREMIUM_AND_SHOP_ENTRY_POINTS", "GIFTING_INTENT_FRIENDS_TAB_BADGE",
    "QUEST_HOME_ENTRYPOINT_HERO_BADGE", "QUEST_HOME_NEW_QUEST_BADGE", "PREMIUM_ORBS_UPSELL_POPOVER",
    "ORB_WALLET_NITRO_UPSELL_CTA_CARD", "BOOST_PROGRESS_BAR_MEMBER_COACHMARK", "BOOST_TO_UNLOCK_COACHMARK",
    "FIRST_BOOSTER_UPSELL", "GUILD_BOOST_TAB_BANNER", "GUILD_BOOST_TAB_HIGHLIGHT",
    "PREMIUM_MARKETING_MOMENT_DESKTOP_ANNOUNCEMENT_MODAL", "ML_REVERSE_TRIAL_UPSELL_MODAL",
    "ML_REVERSE_TRIAL_FOLLOWUP_UPSELL_MODAL", "CLIENT_THEMES_COACHMARK", "CUSTOM_CALL_SOUNDS_PICKER_UPSELL",
    "NITRO_GDM_CAP_COACHMARK", "CONTEXTUAL_REFERRAL_GDM_MEMBER_LIST_EMBED", "TRIAL_NUX_STREAM_COACH_MARK",
    "BADGE_CUSTOMIZATION_WEB_COACHMARK", "USER_PROFILE_PERSONAL_WIDGET_COACHMARK", "GIFT_CARDS_MARKETING_COACHMARK",
    "PROFILE_FRAME_USER_PROFILE_NEW_BADGE", "DISPLAY_NAME_STYLES_FLYWHEEL_EDIT_PROFILE_NEW_BADGE",
];
let suppressedDCs: Set<number> | undefined;

let style: HTMLStyleElement | undefined;

function hasSubscription() {
    const user = UserStore.getCurrentUser();
    // Keep account controls available until the current user is known.
    return user == null || !!user.premiumType;
}

function updateStyle() {
    if (!style) return;

    const { store } = settings;
    const subscribed = hasSubscription();
    style.textContent = Object.entries(HIDE_SELECTORS)
        .filter(([key]) => store[key as SettingKey] && !(subscribed && SUBSCRIBER_EXEMPT.has(key as SettingKey)))
        .flatMap(([, selectors]) => selectors)
        .map(selector => `${selector} { display: none !important; }`)
        .join("\n");
}

export default definePlugin({
    name: "Impede",
    description: "Hides Discord's ads (Quests), Nitro and Shop upsells, and Server Boost prompts",
    tags: ["Appearance"],
    searchTerms: ["ads", "nitro", "quests", "orbs", "shop", "boost", "upsell", "gift"],
    authors: [{ name: "yasmin", id: 0n }],
    settings,

    patches: [
        // P1: DM-list rows
        {
            find: 'tutorialId:"direct-messages"',
            replacement: [
                { match: /"nitro-tab-group"\)/, replace: "$&&&undefined", predicate: () => settings.store.dmNitro },
                { match: /NAVIGATION_LINK\}\}\},"discord-shop"\)/, replace: "$&&&undefined", predicate: () => settings.store.dmShop },
                { match: /\.QUEST_HOME\)\},"quests"\)/, replace: "$&&&undefined", predicate: () => settings.store.dmQuests },
            ],
        },
        // P2: keyboard-navigation list for the same rows; the array is filtered with x != null
        {
            find: ".hasLibraryApplication()&&!",
            replacement: [
                { match: /\i\.\i\.APPLICATION_STORE,/, replace: "", predicate: () => settings.store.dmNitro },
                { match: /\i\.\i\.COLLECTIBLES_SHOP,/, replace: "", predicate: () => settings.store.dmShop },
                { match: /\i\.\i\.QUEST_HOME(?=\]\.filter)/, replace: "null", predicate: () => settings.store.dmQuests },
            ],
        },
        // P3a: Quest bar visibility; also makes isQuestBarEmpty true so the account panel keeps its corners
        {
            find: 'reason:"quest_bar_visible"',
            predicate: () => settings.store.questBar,
            replacement: { match: /(?<=\{isQuestBarVisible:)!0(?=,reason:"quest_bar_visible"\})/g, replace: "!1" },
        },
        // P3b: Quest bar root; covers QUEST, BOUNTY and NO_FILL creatives
        {
            find: '"useNoFillAd")',
            predicate: () => settings.store.questBar,
            replacement: { match: /(?=switch\(\i\.type\)\{case \i\.\i\.QUEST:\{let\{quest:)/, replace: "return null;" },
        },
        // P4: channel-list action rows
        {
            find: "useGuildActionRow",
            replacement: [
                { match: /(?=\i\.push\(\i\.\i\.GUILD_PREMIUM_PROGRESS_BAR\))/, replace: "false&&", predicate: () => settings.store.boostBar },
                { match: /(?=\i\.push\(\i\.\i\.GUILD_BOOSTS\))/, replace: "false&&", predicate: () => settings.store.boostRow },
            ],
        },
        // P5: chat-bar gift button
        {
            find: '"sticker")',
            predicate: () => settings.store.giftButton,
            replacement: { match: /&&\i\.push\(\([^&]*?,"gift"\)\)/, replace: "" },
        },
        // P6: promotional notice bars. The store shows only the first notice in its priority list
        // whose conditions hold, and promos come before payment problems, so promos are skipped
        // there to let the next notice through. The second patch hides any promo that still
        // reaches the notice bar.
        {
            find: 'displayName="NoticeStore"',
            predicate: () => settings.store.nagbars,
            replacement: {
                match: /for\(let (\i) of \i\)if\((?=null!=(\i)\[\1\]&&\2\[\1\]\.predicate\()/,
                replace: "$&!$self.isPromoNotice($1)&&",
            },
        },
        {
            find: ".APP_NOTICE_VIEWED,",
            predicate: () => settings.store.nagbars,
            replacement: { match: /(?<=\(\)=>)\i\.getNotice\(\)/, replace: "$self.filterNotice($&)" },
        },
        // P8: Nitro-locked emoji, filtered from the data so the virtualised picker has no gaps.
        // The second replacement drops the "Available with Nitro" section from search results.
        {
            find: "#{intl::EMOJI_PICKER_EXPAND_EMOJI_SECTION}),size:",
            predicate: () => settings.store.lockedEmoji,
            replacement: [
                { match: /(\i)=\i\|\|!\i&&\i\.\i\.isEmojiCategoryNitroLocked\(\{[^}]*\}\);/, replace: "$&$1||" },
                {
                    match: /(?<=0!==(\i)\.locked\.length&&)(?=\i\(\1\.locked,\{type:\i\.\i\.PREMIUM_UPSELL,categoryId:\i\.\i\.PREMIUM_UPSELL,sectionId:\i\.\i\.PREMIUM_UPSELL,count:\1\.locked\.length,isNitroLocked:!(\i)\}\))/,
                    replace: "$2&&",
                },
            ],
        },
        {
            find: "#{intl::EMOJI_CATEGORY_TOP_GUILD_EMOJI},{guildName:",
            predicate: () => settings.store.lockedEmoji,
            replacement: { match: /(?<=(\i)\.unshift\((\i)\):)(?=\1\.push\(\2\))/, replace: "$2.isNitroLocked||" },
        },
        // P9: message-length upsell tooltip. Vencord's CharacterCounter may already have inserted
        // the same "return null;", so the lookahead allows for it.
        {
            find: "#{intl::PREMIUM_MESSAGE_LENGTH_UPSELL_TOOLTIP}",
            predicate: () => settings.store.messageLength,
            replacement: { match: /(?<=\.PREMIUM_UPSELL\);)(?=(?:return null;)?.{0,50}\.PREMIUM_UPSELL_VIEWED)/, replace: "return null;" },
        },
        // P10: Discover → Quests tab
        {
            find: "GLOBAL_DISCOVERY_SIDEBAR},",
            predicate: () => settings.store.discoverQuests,
            // Discord drops the tab itself when an experiment is on; force that branch.
            replacement: { match: /location:"GlobalDiscoverySidebar"\}\)\.enabled(?=\?\i\.GLOBAL_DISCOVERY_TABS\.filter\()/, replace: "$&||!0" },
        },
        // P11: Active Now quest promo
        {
            find: "`application-stream-",
            predicate: () => settings.store.activeNowQuest,
            replacement: { match: /(?<=let\{party:\i,onChannelContextMenu:\i,)quest:(\i)/, replace: "impedeNoQuest:$1=null" },
        },
        // P12: member-list quest icon
        {
            find: '("ActivityStatus"),',
            predicate: () => settings.store.memberQuestIcon,
            replacement: { match: /,hasQuest:(?=\i=!1)/, replace: ",impedeNoQuest:" },
        },
        // P13: quest and Orb profile badges
        {
            find: ".MODAL]:26",
            predicate: () => settings.store.questBadges,
            replacement: {
                match: /(,\{badges:\i)(?=,overflowCount:\i,displayProfile:\i)/,
                replace: '$1.filter(b=>!["quest_completed","orb_profile_badge"].includes(b.id))',
            },
        },
        // P14: stop fetching quests
        {
            find: 'type:"QUESTS_FETCH_CURRENT_QUESTS_BEGIN"',
            group: true,
            predicate: () => settings.store.blockQuestFetch,
            replacement: [
                { match: /(?<=if\(\i\.\i\.isFetchingCurrentQuests)/, replace: "||true" },
                { match: /(?=let \i=Date\.now\(\);\i\.recordQuestRequestAttempt.{0,50}QUESTS_FETCH_QUEST_TO_DELIVER_BEGIN)/, replace: "return;" },
            ],
        },

        // P15: the new-user cooldown filter, which every coachmark, popover and announcement goes
        // through. The first replacement drops suppressed units from candidate lists; the second
        // makes single-unit checks report them as blocked.
        {
            find: 'location:"useDcfNewUserCooldown"',
            predicate: () => settings.store.coachmarks,
            replacement: [
                {
                    match: /(?<=function \i\((\i)\)\{)(?=let \i=\i\.useConfig\(\{location:"useDcfNewUserCooldown"\}\))/,
                    replace: "$1=Array.isArray($1)?$1.filter(x=>!$self.isSuppressedDC(x)):$1;",
                },
                { match: /(?<=function \i\((\i)\)\{return)(?=!\i\.\i\.newUserMinAgeRequiredOverridden&&)/, replace: " $self.isSuppressedDC($1)||" },
            ],
        },

        // P16: shared subscribe buttons and the "Get Nitro" action of the roadblock modal, which
        // most upsells outside the patches below use. Subscribers keep the buttons. Change the
        // rendered result after the hooks, so subscription changes cannot change their order.
        {
            find: '"buttonShineClassName"in',
            predicate: () => settings.store.subscribeButtons,
            replacement: {
                match: /return(?=\(0,\i\.jsx\)\(\i\.\i,\{onClick:\i,subscriptionTier:\i,postSuccessGuild:)/,
                replace: "return !$self.hasSubscription()?null:",
            },
        },
        {
            find: ".disabled||!0===",
            predicate: () => settings.store.subscribeButtons,
            replacement: {
                match: /return(?=\(0,\i\.jsx\)\(\i\.\i,\{onClick:\i,subscriptionTier:\i,postSuccessGuild:)/,
                replace: "return !$self.hasSubscription()?null:",
            },
        },
        {
            find: '?"free_trial":',
            predicate: () => settings.store.subscribeButtons,
            replacement: {
                match: /,(\{text:\i,variant:"expressive",size:"md",onClick:async \i=>\{await \i\(\),\i\(\i\)\},icon:\i\.\i\})(?=\])/,
                replace: ",...($self.hasSubscription()?[$1]:[])",
            },
        },

        // P17: emoji popout in chat; non-Nitro users get the Nitro users' buttons and no Nitro text
        {
            find: "#{intl::EMOJI_POPOUT_CURRENT_GUILD_DESCRIPTION}",
            predicate: () => settings.store.expressionUpsells,
            replacement: [
                { match: /return (\i)&&(\i)\?(?=\{type:"JOIN_GUILD")/, replace: "return $2?" },
                { match: /type:"GET_PREMIUM",text:\i\.intl\.string\(\i\.t#{intl::EMOJI_POPOUT_PREMIUM_CTA}\)/, replace: 'type:"UNAVAILABLE",text:null' },
                { match: /\i\.intl\.string\(\i\.t#{intl::EMOJI_POPOUT_CURRENT_GUILD_DESCRIPTION}\)/, replace: "null" },
                { match: /\i\.intl\.string\(\i\.t#{intl::EMOJI_POPOUT_JOINED_GUILD_DESCRIPTION}\)/, replace: "null" },
                { match: /\i\.intl\.string\(\i\.t#{intl::EMOJI_POPOUT_UNJOINED_DISCOVERABLE_GUILD_DESCRIPTION}\)/, replace: "null" },
                {
                    match: /\i\.intl\.format\(\i\.t#{intl::EMOJI_POPOUT_UNJOINED_PRIVATE_GUILD_DESCRIPTION},\{openPremiumSettings:\i\}\)/,
                    replace: '$self.message("EMOJI_POPOUT_PREMIUM_UNJOINED_PRIVATE_GUILD_DESCRIPTION")',
                },
            ],
        },
        // P18: sticker popout in chat, the same way
        {
            find: '"Custom Sticker Popout (Upsell)"',
            predicate: () => settings.store.expressionUpsells,
            replacement: [
                {
                    match: /(?<=\(\i=)\i\?\i\.intl\.string\(\i\.t#{intl::STICKER_POPOUT_CURRENT_GUILD_DESCRIPTION}\):\i\.intl\.string\(\i\.t#{intl::STICKER_POPOUT_JOINED_GUILD_DESCRIPTION}\),(\i)=!0/,
                    replace: "null,$1=!1",
                },
                { match: /(?<=\(\i=)\i\.intl\.string\(\i\.t#{intl::STICKER_POPOUT_UNJOINED_DISCOVERABLE_GUILD_DESCRIPTION}\),(\i)=!0/, replace: "null,$1=!1" },
                {
                    match: /\i\.intl\.format\(\i\.t#{intl::STICKER_POPOUT_UNJOINED_PRIVATE_GUILD_DESCRIPTION},\{openPremiumSettings:\(\)=>\{\i\(\i\),\i\(\)\}\}\)/,
                    replace: '$self.message("STICKER_POPOUT_PREMIUM_UNJOINED_PRIVATE_GUILD_DESCRIPTION")',
                },
                {
                    match: /\i\.intl\.format\(\i\.t#{intl::STICKER_POPOUT_UNJOINED_PRIVATE_GUILD_DESCRIPTION},\{openPremiumSettings:\(\)=>\{\i\(\),\i\(\i\)\}\}\)/,
                    replace: '$self.message("STICKER_POPOUT_PREMIUM_UNJOINED_PRIVATE_GUILD_DESCRIPTION")',
                },
                { match: /(?<=let \i=!\i&&!\i&&\i)&&\i(?=;return\()/, replace: "" },
            ],
        },
        // P19: Super Reactions: the launch coachmark, and the picker toggle unless you have Nitro
        {
            find: "#{intl::SUPER_REACTIONS_LAUNCH_COACHMARK_DESCRIPTION_UNLIMITED_V2}",
            predicate: () => settings.store.expressionUpsells,
            replacement: [
                { match: /(?<=\.REACTION\?\(0,\i\.jsx\)\(\i,\{targetElementRef:\i,shouldShow:)/, replace: "!1&&" },
                { match: /(?<=\i===\i\.\i\.REACTION)(?=\?\(0,\i\.jsx\)\(\i,\{checked:\i,onClick:\i,buttonRef:\i\}\))/, replace: "&&$self.hasSubscription()" },
            ],
        },
        // P20: Super Reaction tooltip text, and the upsell modal its click opens
        {
            find: '"super reaction tooltip upsell"',
            predicate: () => settings.store.expressionUpsells,
            replacement: [
                {
                    match: /\i(?=\?null:\(0,\i\.jsx\)\("div",\{className:\i\(\)\(\i\.\i,\i\.\i\),children:\(0,\i\.jsxs\)\("div",\{children:\[\(0,\i\.jsx\)\(\i\.\i,\{variant:"text-sm\/normal","aria-label":"super reaction tooltip upsell")/,
                    replace: "!0",
                },
                { match: /(?<=if\(\i&&!\i\)return void)\(0,\i\.\i\)(?=\(\{analytics:\{type:\i\.\i\.BURST_REACTION_UPSELL)/, replace: "(()=>{})" },
            ],
        },
        // P21: sticker picker. Locked sections and search results go with lockedEmoji; the
        // click card and the empty-state upsell with expressionUpsells.
        {
            find: '"stickers-available-with-nitro-header"',
            replacement: [
                {
                    match: /(?<=function \i\(\i,\i,\i,(\i)\)\{return \i\.useMemo\(\(\)=>)\1(?=\?\i\.flatMap\(\i=>\{let \i=function)/,
                    replace: "($1||!$self.hasSubscription())",
                    predicate: () => settings.store.lockedEmoji,
                },
                { match: /return null!=(\i)\?\[\1\]:\[\]/, replace: "return null==$1||$1.isNitroLocked?[]:[$1]", predicate: () => settings.store.lockedEmoji },
                {
                    match: /(?<=\i===\i\.\i\.SENDABLE\?\i\.push\(\i\):)\i===\i\.\i\.SENDABLE_WITH_PREMIUM&&/,
                    replace: "!1&&",
                    predicate: () => settings.store.lockedEmoji,
                },
                {
                    match: /\i(?=&&\(\i\?\(0,\i\.jsx\)\(\i,\{onUpsellClicked:\i\}\):\(0,\i\.jsx\)\(\i,\{onLearnMore:\i\}\)\))/,
                    replace: "!1",
                    predicate: () => settings.store.expressionUpsells,
                },
                {
                    match: /(?<=function \i\(\i\)\{let\{className:\i,onClose:\i\}=\i;)(?=\(0,\i\.\i\)\(\);let\{analyticsLocations:\i\}=\(0,\i\.\i\)\(\i\.\i\.EMPTY_STATE\))/,
                    replace: "return null;",
                    predicate: () => settings.store.expressionUpsells,
                },
            ],
        },
        // P22: soundboard picker: sections of sounds you need Nitro to use
        {
            find: 'location:"useSoundGrid"',
            predicate: () => settings.store.lockedEmoji,
            replacement: {
                match: /(\i)\.filter\((\i)=>\2\.items\.length>0\)(?=,\[\1\]\),\i=\i\.useMemo\(\(\)=>\i\.findLastIndex\()/,
                replace: "$1.filter($2=>$2.items.length>0&&!$2.categoryInfo.isNitroLocked)",
            },
        },
        // P23: the card shown when you click a locked emoji, sticker or sound
        {
            find: '"nitro-pink":"green"',
            predicate: () => settings.store.expressionUpsells,
            replacement: { match: /(?<=function \i\(\i\)\{)(?=let \i,\{title:\i,description:\i,analyticsLocationSection:)/, replace: "return null;" },
        },
        // P24: floating "Unlock with Nitro" bar at the bottom of the pickers
        {
            find: "let{showUpsell:",
            predicate: () => settings.store.expressionUpsells,
            replacement: { match: /(?<=function \i\(\i\)\{)(?=let\{showUpsell:\i,text:\i,textVariant:)/, replace: "return null;" },
        },
        // P25: soundboard quick access: the locked slot
        {
            find: "useFavoriteAndFrequentlyUsedSounds",
            predicate: () => settings.store.expressionUpsells,
            replacement: [
                { match: /(?<=let )(\i)=(\i)\.length>0\?\2\[0\]:null(?=,\i=null!=\1)/, replace: "$1=null" },
                { match: /(?<=hasLockedSound:)\i\.length>0/, replace: "!1" },
            ],
        },
        // P26: soundboard sound details
        {
            find: ".SOUNDBOARD_ECHO_SOUND_DETAILS_UPSELL,",
            predicate: () => settings.store.expressionUpsells,
            replacement: { match: /(?<=function \i\(\i\)\{)(?=let\{sourceGuildName:\i,isExternal:\i\}=\i,)/, replace: "return null;" },
        },
        // P27: entrance sounds card in the soundboard and in settings
        {
            find: "#{intl::CALL_SOUNDS_UPSELL_DESCRIPTION_NON_SUB}",
            predicate: () => settings.store.expressionUpsells,
            replacement: {
                match: /(?<=,(\i)=\i\.\i\.canUseCustomCallSounds\(\i\);)(?=return\(0,\i\.jsxs\)\(\i\.A,\{isShown:!0)/,
                replace: "if(!$1)return null;",
            },
        },
        {
            find: ".CUSTOM_CALL_SOUNDS_PICKER_UPSELL)}return",
            predicate: () => settings.store.expressionUpsells,
            replacement: {
                match: /\((\i\.\i\.canUseCustomCallSounds\(\i\))\|\|\i\)(?=&&\i\.push\(\i\.\i\.CUSTOM_CALL_SOUNDS_PICKER_UPSELL\))/,
                replace: "$1",
            },
        },
        // P28: Soundmoji info popout. The messages have no known key names, so their hashes are used;
        // hashes containing "/" are written out, since #{intl::} cannot hold one in a regex literal.
        {
            find: 'location:"useSoundmojiGuildInfoData"',
            predicate: () => settings.store.expressionUpsells,
            replacement: [
                { match: /(?<=\i\|\|!\i\?2:)\i\?(\i\|\|null==\i\?2:0):1/, replace: "$1" },
                { match: /(?<=\(\)=>)\i\.intl\.string\(\i\.t\["sj\/imS"\]\)/, replace: '$self.messageFromHash("p17MQJ")' },
                { match: /(?<=\(\)=>)\i\.intl\.string\(\i\.t\["3Ru2\/x"\]\)/, replace: '$self.messageFromHash("Lkbm5s")' },
                { match: /(?<=\(\)=>)\i\.intl\.string\(\i\.t#{intl::qRkWhZ::raw}\)/, replace: "null" },
            ],
        },

        // P29: profile popout and full profile: the Nitro and Shop aside, and overflow-menu items
        {
            find: ".USER_PROFILE_PREMIUM_AND_SHOP_ENTRY_POINTS),",
            predicate: () => settings.store.profileUpsells,
            replacement: { match: /(?<=,\i=)\(0,\i\.\i\)\(\i\.\i\.USER_PROFILE_PREMIUM_AND_SHOP_ENTRY_POINTS\)(?=,)/, replace: "!0" },
        },
        {
            find: 'id:"shop-this-look"',
            predicate: () => settings.store.profileUpsells,
            replacement: [
                { match: /(?<=if\()(?=[^)]+\)return null;let \i=[^;]+;return\(0,\i\.jsxs\)\(\i\.\i,\{id:"shop-this-look")/, replace: "!0||" },
                { match: /(?<=return )(?=(?:\i&&)*\i\?\(0,\i\.jsx\)\(\i\.\i,\{id:"referral-profile-share-nitro")/, replace: "!1&&" },
            ],
        },
        // P30: badges: "Reorder badges with Nitro", the Nitro tenure modal, and badge-directory CTAs
        {
            find: 'action:"VIEW_BADGE_CUSTOMIZATION"',
            predicate: () => settings.store.profileUpsells,
            replacement: { match: /,(\i)=!(\i)&&!(\i),(\i)=\2\?/, replace: ",$1=!1,$4=$2?" },
        },
        {
            find: 'type:"Tiered Tenure Badge Details"',
            predicate: () => settings.store.profileUpsells,
            replacement: {
                match: /(?<=function \i\(\i\)\{)(?=let\{analyticsLocations:\i,displayProfile:\i,location:\i\}=\i;)/,
                replace: "if(!$self.hasSubscription())return;",
            },
        },
        {
            find: '"badge-details"',
            predicate: () => settings.store.profileUpsells,
            replacement: { match: /\[\i\.\i\.(PREMIUM_TENURE|GUILD_BOOSTER|ORB_PROFILE|GIFTING)\]:\{ctaLabel:/g, replace: '["impede_$1"]:{ctaLabel:' },
        },
        // P31: profile editor: Shop button, try-it-out and Get Nitro, per-server upsell, wishlist tab
        {
            find: '"user-profile-editing-panel"',
            replacement: [
                {
                    match: /(?<=\i&&\(0,\i\.jsxs\)\(\i\.Fragment,\{children:\[)\(0,\i\.jsx\)\(\i,\{user:\i\}\),\(0,\i\.jsx\)\(\i,\{\}\)(?=\]\}\))/,
                    replace: "",
                    predicate: () => settings.store.profileUpsells,
                },
                {
                    match: /(\i)&&\((\i)\?(\(0,\i\.jsx\)\(\i,\{\}\)):\(0,\i\.jsx\)\(\i,\{\}\)\)(?=,\2&&\(0,\i\.jsx\)\(\i,\{\}\))/,
                    replace: "$1&&$2&&$3",
                    predicate: () => settings.store.profileUpsells,
                },
                {
                    match: /\i(?=\.push\(\{text:\i\.intl\.string\(\i\.t#{intl::USER_PROFILE_WISHLIST}\),section:\i\.\i\.WISHLIST)/,
                    replace: "[]",
                    predicate: () => settings.store.wishlists,
                },
            ],
        },
        {
            find: 'action:"VISIT_SHOP"',
            predicate: () => settings.store.profileUpsells,
            replacement: { match: /return(?=\(0,\i\.jsx\)\(\i\.\i,\{action:"VISIT_SHOP")/, replace: "return null;" },
        },
        // P32: Settings → Profiles: Shop banner and Nitro try-it-out
        {
            find: "PREMIUM_WISHLIST_EDIT_PROFILE_UPSELL}",
            predicate: () => settings.store.profileUpsells,
            replacement: [
                {
                    match: /(?<==function\(\)\{)(?=let \i,\i,\i,\i,\{analyticsLocations:\i\}=\(0,\i\.\i\)\(\i\.\i\.COLLECTIBLES_PROFILE_SETTINGS_UPSELL\))/,
                    replace: "return null;",
                },
                {
                    match: /(?<=\i\.useState\(!1\),)(\i)=!\i(?=,\i=\i\.useRef\(null\);return \i\?\(0,\i\.jsx\)\(\i\.\i,\{\}\):\(0,\i\.jsxs\)\(\i\.\i,\{value:\i,children:\[\(0,\i\.jsx\)\(\i,\{\}\))/,
                    replace: "$1=!1",
                },
            ],
        },
        // P33: profile preview: "Unlock with Nitro" banner and locked avatar overlay
        {
            find: "#{intl::USER_SETTINGS_UNLOCK_BANNER}",
            predicate: () => settings.store.profileUpsells,
            replacement: [
                { match: /overlay:!(\i)&&(?=\(0,\i\.jsxs\)\(\i\.\i,\{onClick:function\(\)\{(\i)\|\|(\i)\?)/, replace: "overlay:!$1&&($2||$3)&&" },
                { match: /return (\i)\?(?=\(0,\i\.jsx\)\("div",\{className:\i\.\i,children:\i\}\):(\i)\?)/, replace: "return $1||!$2?" },
            ],
        },
        // P34: upsell modal after choosing an animated avatar or a banner without Nitro; the upload
        // is still refused
        {
            find: "maybeOpenProfilePreviewModal(e){",
            predicate: () => settings.store.profileUpsells,
            replacement: { match: /\(0,\i\.\i\)\(\{uploadType:\i\.\i\.(?:AVATAR|BANNER)\}\)/g, replace: "void 0" },
        },
        // P35: decoration, effect and nameplate pickers: Shop tile, Shop previews, Nitro-only items
        {
            find: '{skuId:"Shop"}',
            all: true,
            predicate: () => settings.store.profileUpsells,
            replacement: [
                { match: /(?<=section:"purchase",items:\[\i),\i(?=,\.\.\.\i\.purchase\])/, replace: "" },
                { match: /(?<=section:"preview",items:)\i\.preview/, replace: "[]" },
                { match: /(?<=section:"premium_purchase",items:)\i\.premium_purchase/, replace: "$self.filterNitroCollectibles($&)" },
            ],
        },
        {
            find: "#{intl::PREMIUM_UPSELL_PROFILE_AVATAR_DECO_INLINE_UPSELL}",
            predicate: () => settings.store.profileUpsells,
            replacement: { match: /return null==(\i)\?null:(?=\(0,\i\.jsxs\)\("div")/, replace: "return null;" },
        },
        {
            find: "DISPLAY_NAME_STYLES_NITRO_CLICKED)",
            predicate: () => settings.store.profileUpsells,
            replacement: { match: /(?<=\{"data-migration-pending":!0,className:\i\.\i,children:\i\|\|\i\?\i:)\i(?=\}\))/, replace: "null" },
        },
        // P36: wishlists in the profile popout and the full profile sidebar
        {
            find: 'location:"UserProfilePopout"',
            predicate: () => settings.store.wishlists,
            replacement: { match: /(?<=\{)hasNewWishlistItems:(?=\i,newWishlistItemCount:)/, replace: "impedeHasNewWishlistItems:" },
        },
        {
            find: 'location:"UserProfileSidebarWishlistBreadcrumb"',
            predicate: () => settings.store.wishlists,
            replacement: { match: /(?<=function \i\(\i\)\{)(?=let\{isLoading:\i,unownedWishlistItems:)/, replace: "return null;" },
        },

        // P37: start-up announcement modal and reverse-trial modals
        {
            find: '"PremiumServerDriveAnnouncementModal"',
            predicate: () => settings.store.nitroPopups,
            replacement: { match: /(?<=maybeShowAnnouncementModalFromPromotions=\i=>\{)/, replace: "return;" },
        },
        {
            find: '"ReverseTrialUpsellModal"',
            predicate: () => settings.store.nitroPopups,
            replacement: {
                match: /(?<=function \i\(\i,\i,\i\)\{)(?=if\(\(0,\i\.hasAnyModalOpen\)\(\)\)return;let\{isDismissed:\i\}=\(0,\i\.u\$\)\(\i,\i\);)/,
                replace: "return;",
            },
        },
        // P38: streaming: Go Live HD ribbon and pill, locked quality options, quality indicator,
        // stream trial coachmark
        {
            find: "#{intl::sLJ3EV::raw}",
            predicate: () => settings.store.nitroPopups,
            replacement: [
                { match: /(?<=let \i=)(?=!\i\.\i\.canStreamQuality\(\i\.\i\.StreamQuality\.HIGH,\i\))/, replace: "!1&&" },
                { match: /(?<=\i=\i=>\{let\{analyticsLocation:\i,onClose:\i\}=\i;)(?=\(0,\i\.openModalLazy\))/, replace: "return;" },
            ],
        },
        {
            find: 'group:"stream-settings-fps"',
            predicate: () => settings.store.nitroPopups,
            replacement: { match: /(?<=\}else\{)(?=var \i;\i=\{\.\.\.\i,object:\i\.\i\.RADIO_ITEM)/, replace: "return;" },
        },
        {
            find: ".STREAM_QUALITY_INDICATOR,has_premium_stream_fps",
            predicate: () => settings.store.nitroPopups,
            replacement: { match: /(?<=\i=)\i(?=&&!\i\.\i\.isPremium\(\i,\i\.PremiumTypes\.TIER_1\)&&!\i\.\i\.canStreamQuality\()/, replace: "!1" },
        },
        {
            find: ".TRIAL_NUX_STREAM_COACH_MARK],bypassAutoDismiss",
            predicate: () => settings.store.nitroPopups,
            replacement: {
                match: /(?<=function\(\)\{if\()(?=\i&&0===\i\.length\)return\(0,\i\.jsx\)\(\i\.\i,\{contentTypes:\[\i\.\i\.TRIAL_NUX_STREAM_COACH_MARK\])/,
                replace: "!1&&",
            },
        },
        // P39: camera background upload tile, and the file-too-large modal (the plain error stays)
        {
            find: "#{intl::CAMERA_PREVIEW_VIDEO_BACKGROUND_UPSELL_TOOLTIP}",
            predicate: () => settings.store.nitroPopups,
            replacement: { match: /(?<=\i\?\(0,\i\.jsx\)\(\i,\{onAddBackgroundImage:\i,disabled:\i\}\):)\(0,\i\.jsx\)\(\i,\{onClick:\i\}\)/, replace: "null" },
        },
        {
            find: ".FILE_UPLOAD_UPSELL_MODAL,location_object",
            predicate: () => settings.store.nitroPopups,
            replacement: { match: /(?<=showPremiumUpsell:(\i),effectiveMaxSize:\i,transitionState:\i,onClose:\i\}=\i;return )\1\?/, replace: "!1?" },
        },
        // P40: scheduled messages: the inbox bar, and the limit roadblock (the plain alert stays)
        {
            find: '"ScheduledMessageInboxTab"',
            predicate: () => settings.store.nitroPopups,
            replacement: { match: /\i(?=\?\(0,\i\.jsx\)\("div",\{className:\i\.\i,children:\(0,\i\.jsx\)\(\i,\{isAtLimit:\i\}\)\}\):null)/, replace: "!1" },
        },
        {
            find: '"ScheduledMessagesCreateRoadblock"',
            predicate: () => settings.store.nitroPopups,
            replacement: { match: /(?<=\("ScheduledMessagesCreateRoadblock"\);)\i(?=\?\(0,\i\.openModalLazy\))/, replace: "!1" },
        },
        // P41: server cap: the bar in the invite modal, the "join more servers" modal, and "Add a
        // Server", which opens the normal modal at the cap
        {
            find: "#{intl::GUILD_CAP_UPSELL_TOOLTIP}",
            predicate: () => settings.store.nitroPopups,
            replacement: {
                match: /(?<=function \i\(\i\)\{)(?=let\{className:\i\}=\i,\{analyticsLocations:\i,sourceAnalyticsLocations:\i\}=\(0,\i\.\i\)\(\i\.\i\.PREMIUM_UPSELL_TOOLTIP\))/,
                replace: "return null;",
            },
        },
        {
            find: '"nitro-guild-cap-upsell"',
            predicate: () => settings.store.nitroPopups,
            replacement: {
                match: /(?<=function \i\(\i\)\{)(?=let\{onCloseCallback:\i,analyticsLocations:\i,\.\.\.\i\}=\i;\(0,\i\.openModalLazy\))/,
                replace: "return;",
            },
        },
        {
            find: 'id:"create-join-button"',
            predicate: () => settings.store.nitroPopups,
            replacement: { match: /\(0,\i\.\i\)\(\)(?=\?\(0,\i\.\i\)\(\{analyticsSource:\{page:\i\.\i\.CREATE_JOIN_GUILD_MODAL\})/, replace: "!1" },
        },
        // P42: group DMs: the member-limit coachmark, banner and "group is full" upsell, and the
        // "Share Nitro Perks" card in the member list
        {
            find: "renderNitroUpsellBannerOverlay(){",
            predicate: () => settings.store.nitroPopups,
            replacement: [
                { match: /(?<=\(0,\i\.kn\)\()(?=\i&&!\i\?\[\i\.\i\.NITRO_GDM_CAP_COACHMARK\])/, replace: "!1&&" },
                { match: /(?<=renderNitroUpsellBannerOverlay\(\)\{)/, replace: "return null;" },
                { match: /(?<=renderNitroCapFullState\(\)\{let\{transitionState:\i,onClose:\i,nitroAudience:\i\}=this\.props;if\()/, replace: "!1&&" },
            ],
        },
        {
            find: 'location:"ContextualReferralGDMMemberListEmbed"',
            predicate: () => settings.store.nitroPopups,
            replacement: { match: /(?<=contentType:)(?=\i\?\i\.\i\.CONTEXTUAL_REFERRAL_GDM_MEMBER_LIST_EMBED:null)/, replace: "!1&&" },
        },
        // P43: "Powered by Nitro" system message button, Favorites upsell, loading-screen tip
        {
            find: "unknown message type ${",
            predicate: () => settings.store.nitroPopups,
            replacement: { match: /(?<=\i\.intl\.string\(\i\.t#{intl::POWERED_BY_NITRO}\)\}\)\]\}\)\]\}\),)/, replace: "null&&" },
        },
        {
            find: ".FAVORITES_GUILD_UPSELL_MODAL_OPENED,",
            predicate: () => settings.store.nitroPopups,
            replacement: {
                match: /,\{text:\i\.intl\.string\(\i\.t#{intl::PREMIUM_UPSELL_GET_NITRO}\),variant:"expressive",icon:\i\.\i,onClick:\(\)=>\{\i\(\),\(0,\i\.\i\)\(\{subscriptionTier:\i\.\i\.TIER_2,analyticsLocations:\i\}\)\}\}/,
                replace: "",
            },
        },
        {
            find: "#{intl::LOADING_TIP_20}",
            predicate: () => settings.store.nitroPopups,
            replacement: { match: /\i\.intl\.string\(\i\.t#{intl::LOADING_TIP_20}\),/, replace: "" },
        },
        // P44: settings: App Icon, Color Themes, Nitro billing banner, Xbox connection
        {
            find: 'id:"upsell-button"',
            predicate: () => settings.store.nitroPopups,
            replacement: { match: /\i(?=&&\i\.push\(\{id:"upsell-button")/, replace: "!1" },
        },
        {
            find: '"--custom-in-app-icon-editor-content-width"',
            predicate: () => settings.store.nitroPopups,
            replacement: [
                // Both start with a literal: a leading \i takes ~20 ms on this 1.3 MB module.
                { match: /children:\[\i&&(?=\(0,\i\.jsx\)\(\i,\{\}\),\(0,\i\.jsx\)\(\i\.\i,\{onClick:function\(\)\{\i\?\.\(\i\.\i\.DISMISS\))/, replace: "children:[!1&&" },
                { match: /push\(\i\.\i\.CLIENT_THEMES_COACHMARK\)/, replace: "push()" },
            ],
        },
        {
            find: ".PREMIUM_CLIENT_THEME_SETTINGS_UPSELL,subscriptionTier",
            predicate: () => settings.store.nitroPopups,
            replacement: [
                { match: /(?<=onClick:\i\}\),)\(0,\i\.jsx\)\(\i,\{\}\)(?=\]\}\))/, replace: "null" },
                {
                    match: /,\(0,\i\.jsx\)\("div",\{className:\i\.\i\}\),\(0,\i\.jsx\)\(\i\.\i,\{type:\i\.\i\.PREMIUM_CLIENT_THEME_SETTINGS_UPSELL,subscriptionTier:\i\.\i\.TIER_2\}\)/,
                    replace: "",
                },
            ],
        },
        {
            find: ".BILLING_SETTINGS_BANNER,component_id:",
            predicate: () => settings.store.nitroPopups,
            replacement: { match: /(?<=function \i\(\i\)\{)(?=let\{component:\i,endDate:\i\}=\i)/, replace: "return null;" },
        },
        {
            find: ".XBOX_CONNECTED_ACCOUNTS_BANNER)",
            predicate: () => settings.store.nitroPopups,
            replacement: {
                match: /if\((\i)===(\i\.\i)\.NONE\)return null;(?=let \i=\i\?"md":"sm")/,
                replace: "if($1===$2.NONE||$1===$2.NO_ACCESS)return null;",
            },
        },
        {
            find: 'location:"Xbox perks reconnect upsell"',
            predicate: () => settings.store.nitroPopups,
            replacement: { match: /(?<=\i\.type===\i\.\i\.XBOX&&)\i(?=\?\(0,\i\.jsx\)\(\i,\{\}\):\i\.twoWayLink)/, replace: "!1" },
        },
        // P45: app directory storefront banner
        {
            find: 'surface:"storefront_banner"',
            predicate: () => settings.store.nitroPopups,
            replacement: {
                match: /,\(0,\i\.jsx\)\(\i\.\$,\{variant:"expressive",size:"sm",icon:\i\.t,text:\i\.intl\.string\(\i\.t#{intl::PREMIUM_UPSELL_GET_NITRO}\),onClick:\i\}\)/,
                replace: "",
            },
        },
        // P46: boosting: the "better price with Nitro" step and the "2 Free Boosts" button
        {
            find: "#{intl::PREMIUM_UPSELL_FEATURE_PRETEXT_TRIAL_VARIANT}",
            predicate: () => settings.store.nitroPopups,
            replacement: {
                match: /(?<=onClick:function\(\)\{)\i\|\|null!=\i&&\i\.premiumSubscriptionType===\i\.PremiumTypes\.TIER_2(?=\?\i\(null!=\i\|\|\i\?\i\.\i\.REVIEW:\i\.\i\.ADD_PAYMENT_STEPS\):\i\(\i\.\i\.PREMIUM_UPSELL\))/,
                replace: "!0",
            },
        },
        {
            find: "#{intl::PREMIUM_GUILD_PERKS_MODAL_SUBSCRIBE_WITH_FREE_BOOSTS}",
            predicate: () => settings.store.nitroPopups,
            replacement: {
                match: /(?<=:)(?=\(0,\i\.jsx\)\(\i\.\$,\{variant:"secondary",size:"md",text:\i\.intl\.string\(\i\.t#{intl::PREMIUM_GUILD_PERKS_MODAL_SUBSCRIBE_WITH_FREE_BOOSTS}\))/,
                replace: "null&&",
            },
        },
        // P47: Orbs and Quests: the "Unlock 1.2x" pills, the Orb wallet card and badge, the
        // balance popout line, and Nitro in quest rewards. Subscribers keep their pills and badges.
        {
            find: "QUEST_HOME_TILE_V2_FOOTER,analyticsCtxQuestContent",
            predicate: () => settings.store.nitroPopups,
            replacement: {
                match: /(?<=(\i)=\(0,\i\.\i\)\(\i\);if\(null==\i)(?=\)return null;let \i=\1\?\i\.intl\.formatToPlainString\(\i\.t#{intl::VIRTUAL_CURRENCY_BONUS_ORBS_MULTIPLIER})/,
                replace: "||!$1",
            },
        },
        {
            find: '"--custom-pill-crepe-bg"',
            predicate: () => settings.store.nitroPopups,
            replacement: {
                match: /(?<=(\i)=\(0,\i\.\i\)\(\i\);if\(null==\i)(?=\)return null;let \i=\1\?\i\.intl\.formatToPlainString\(\i\.t#{intl::VIRTUAL_CURRENCY_BONUS_ORBS_MULTIPLIER})/,
                replace: "||!$1",
            },
        },
        {
            find: '"shop_orbs":null:"nitro_upsell"',
            predicate: () => settings.store.nitroPopups,
            replacement: [
                { match: /(?<=\?null!=\i&&\i>=1400\?"shop_orbs":null:)"nitro_upsell"/, replace: "null" },
                { match: /(?<=onClickBadge:\i,badgeText:)(?=\i\.intl\.format\((\i)\?\i\.default#{intl::MULTIPLIER_BADGE_TEXT}:)/, replace: "!$1?null:" },
            ],
        },
        {
            find: "#{intl::juvXqj::raw}",
            predicate: () => settings.store.nitroPopups,
            replacement: { match: /(?<=children:)(\i)(?=\?\i\.intl\.format\(\i\.default#{intl::juvXqj::raw},)/, replace: "!1" },
        },
        {
            find: ".NITRO_2_POINT_0_CTA)){",
            predicate: () => settings.store.nitroPopups,
            replacement: {
                match: /(?<=(\i)=\i\?\.hasPaidTier2Subscription\(\).{0,1500}?if\(!\i)(?=\)return null;if\(\i\.config\.features\.includes\(\i\.\i\.NITRO_2_POINT_0_CTA\)\))/,
                replace: "||!$1",
            },
        },
        {
            find: "#{intl::QUESTS_REWARD_AVATAR_DECORATION_BODY_WITH_EXPIRATION}",
            predicate: () => settings.store.nitroPopups,
            replacement: {
                match: /(?<=;return )(\i)(?=\?\i\?(\i)\?\i:\i:\2\?\i:\i:\i\.intl\.formatToPlainString\(\i\.t#{intl::QUESTS_REWARD_AVATAR_DECORATION_BODY_WITH_EXPIRATION})/,
                replace: "$1&&$2",
            },
        },

        // P48: friend anniversaries: the Friends-tab badge, the list with Gift buttons and the DM
        // card. The store builds no anniversary lists, as when the notification setting is off.
        {
            find: "canShowFriendsTabBadge(){return",
            predicate: () => settings.store.giftPromotions,
            replacement: { match: /(?<=if\(\i\(\),)(?=!\i\.\i\.hasConsented\(\i\.\i\.PERSONALIZATION\))/, replace: "!0||" },
        },
        // P49: Settings → Gift Inventory: "Claim all gifts with Nitro"
        {
            find: "#{intl::OUTBOUND_PROMO_UPSELL_EXPERIMENT_GIFTS_DESCRIPTION}",
            predicate: () => settings.store.giftPromotions,
            replacement: {
                match: /(?<=\i=)!1===\i&&\i(?=\?\(0,\i\.jsxs\)\("div",\{className:\i\.\i,children:\[\(0,\i\.jsx\)\(\i\.t,\{size:"md",color:\i\.\i\.colors\.REDESIGN_BUTTON_PREMIUM_PRIMARY_PURPLE_FOR_GRADIENT_2)/,
                replace: "!1",
            },
        },
    ],

    contextMenus: {
        "guild-header-popout"(children) {
            if (!settings.store.boostMenuItem) return;

            const group = findGroupChildrenByChildId("premium-subscribe", children);
            const i = group?.findIndex(child => child?.props?.id === "premium-subscribe") ?? -1;
            if (i !== -1) group!.splice(i, 1);
        },
    },

    hasSubscription,

    // Nitro-only collectibles stay in the pickers for Nitro (tier 2) subscribers, who can use them.
    filterNitroCollectibles(items: unknown[]) {
        const user = UserStore.getCurrentUser();
        return user == null || user.premiumType === 2 ? items : [];
    },

    message(key: string) {
        return getIntlMessage(key);
    },

    messageFromHash(hash: string) {
        return getIntlMessageFromHash(hash);
    },

    isPromoNotice(type: string) {
        return PROMO_NOTICES.has(type);
    },

    filterNotice(notice: { type?: string; } | null) {
        return notice != null && PROMO_NOTICES.has(notice.type!) ? null : notice;
    },

    isSuppressedDC(id: number) {
        if (!suppressedDCs) {
            try {
                const ids = SUPPRESSED_DC_NAMES.map(name => DismissibleContent[name]).filter(v => typeof v === "number");
                // The module may not have loaded yet. Retry when another unit is checked.
                if (!ids.length) return false;
                suppressedDCs = new Set(ids);
            } catch {
                return false;
            }
        }
        return suppressedDCs.has(id);
    },

    start() {
        style = createAndAppendStyle("vc-impede", managedStyleRootNode);
        UserStore.addChangeListener(updateStyle);
        updateStyle();
    },

    stop() {
        UserStore.removeChangeListener(updateStyle);
        style?.remove();
        style = undefined;
        suppressedDCs = undefined;
    },
});
