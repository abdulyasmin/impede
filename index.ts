/*
 * impede, a Vencord plugin that hides Discord ads and upsells
 * Copyright (c) 2026 yasmin
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// Patches P1, P2, P5 and P8 are adapted from Equicord's Declutter, P10-P14 from Equicord's
// Questify, and P9 from Vencord's CharacterCounter. Those projects are GPL-3.0-or-later;
// AGPL-3.0 section 13 permits the combination, and the adapted parts stay under the GPL.
// Every patch was checked against Discord stable build 634304 (2026-10-09).

import { findGroupChildrenByChildId } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import { managedStyleRootNode } from "@api/Styles";
import { createAndAppendStyle } from "@utils/css";
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
    lockedEmoji: needsRestart("Hide emoji you need Nitro to use"),
    messageLength: needsRestart("Hide the Nitro upsell when a message is too long"),
    inlineUpsells: live("Hide Nitro banners in pickers, profiles, reactions and appearance settings"),
    giftPromotions: live("Hide partner promotions in Settings → Gift Inventory"),
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
    nagbars: ['[class*="notice_"][class*="colorPremium"]'],
    messageLength: ['[class*="messageLengthUpsellContainer_"]'],
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
    giftPromotions: ['[class*="promotionCard_"]'],
    nitroSettings: ['li[data-settings-sidebar-item="nitro_panel"]'],
    boostRow: ['li:has([id^="skill-trees-"])'],
    boostMenuItem: ["#guild-header-popout-premium-subscribe"],
    boostSettings: ['li[data-settings-sidebar-item="premium_guild_subscriptions_panel"]'],
};

// Notice types dropped by P6. Payment problems (PREMIUM_MISSING_PAYMENT, PREMIUM_PAST_DUE_*)
// and PREMIUM_UNCANCEL describe the user's own subscription, so they stay.
const PROMO_NOTICES = new Set([
    "PREMIUM_PROMO", "PREMIUM_MARKETING_NAGBAR", "PREMIUM_TIER_0_TRIAL_ENDING", "PREMIUM_TIER_2_TRIAL_ENDING",
    "PREMIUM_TIER_2_DISCOUNT_ENDING", "PREMIUM_REACTIVATE", "LOCALIZED_PRICING", "GIFTING_PROMOTION_REMINDER",
    "COLLECTIBLES_SHOP_NAGBAR", "COD_3PP_NAGBAR", "YOUTUBE_3P_NAGBAR", "QUEST_APP_UPSELL", "OUTBOUND_PROMOTION",
    "DETECTED_OFF_PLATFORM_PREMIUM_PERK_UPSELL", "CHECKOUT_RECOVERY_NAGBAR", "VOICE_DARE_OFFER",
]);

// Dismissible-content units dropped by P7. Listed by name, because a pattern over the enum
// would also catch onboarding tips. Nothing is written to the account.
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
];
let suppressedDCs: Set<number> | undefined;

let style: HTMLStyleElement | undefined;

function hasSubscription() {
    return !!UserStore.getCurrentUser()?.premiumType;
}

function updateStyle() {
    if (!style) return;

    const { store } = settings;
    style.textContent = Object.entries(HIDE_SELECTORS)
        .filter(([key]) => store[key as SettingKey] && (key !== "nitroSettings" || !hasSubscription()))
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
        // P6: promotional notice bars
        {
            find: ".APP_NOTICE_VIEWED,",
            predicate: () => settings.store.nagbars,
            replacement: { match: /(?<=\(\)=>)\i\.getNotice\(\)/, replace: "$self.filterNotice($&)" },
        },
        // P7: dismissible-content candidates; client-side only
        {
            find: "userContent?.dismissedContents);return",
            predicate: () => settings.store.coachmarks,
            replacement: { match: /(?<=dismissedContents\);return \i\.filter\()(\i)=>/, replace: "$1=>!$self.isSuppressedDC($1)&&" },
        },
        // P8: Nitro-locked emoji, filtered from the data so the virtualised picker has no gaps
        {
            find: "#{intl::EMOJI_PICKER_EXPAND_EMOJI_SECTION}),size:",
            predicate: () => settings.store.lockedEmoji,
            replacement: { match: /(\i)=\i\|\|!\i&&\i\.\i\.isEmojiCategoryNitroLocked\(\{[^}]*\}\);/, replace: "$&$1||" },
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
            replacement: { match: /(GLOBAL_DISCOVERY_TABS)\.map/, replace: '$1.filter(t=>t!=="quests").map' },
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
    ],

    contextMenus: {
        "guild-header-popout"(children) {
            if (!settings.store.boostMenuItem) return;

            const group = findGroupChildrenByChildId("premium-subscribe", children);
            const i = group?.findIndex(child => child?.props?.id === "premium-subscribe") ?? -1;
            if (i !== -1) group!.splice(i, 1);
        },
    },

    flux: {
        // The current user, and so their subscription, is not known until the gateway connects.
        CONNECTION_OPEN() {
            updateStyle();
        },
    },

    filterNotice(notice: { type?: string; } | null) {
        return notice != null && PROMO_NOTICES.has(notice.type!) ? null : notice;
    },

    isSuppressedDC(id: number) {
        if (!suppressedDCs) {
            try {
                suppressedDCs = new Set(SUPPRESSED_DC_NAMES.map(name => DismissibleContent[name]).filter(v => typeof v === "number"));
            } catch {
                suppressedDCs = new Set();
            }
        }
        return suppressedDCs.has(id);
    },

    start() {
        style = createAndAppendStyle("vc-impede", managedStyleRootNode);
        updateStyle();
    },

    stop() {
        style?.remove();
        style = undefined;
    },
});
