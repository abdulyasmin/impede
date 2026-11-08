// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import { runInNewContext } from "node:vm";

const source = stripTypeScriptTypes(readFileSync(new URL("../index.ts", import.meta.url), "utf8"))
    .replace(/^import .+;$/gm, "")
    .replace("export default definePlugin(", "globalThis.plugin = definePlugin(");

function loadPlugin() {
    let user;
    let enumReady = false;
    let enumThrows = true;
    const listeners = new Set();
    const styles = [];
    const alerts = [];
    const context = {
        Alerts: { show: alert => alerts.push(alert) },
        definePlugin: plugin => plugin,
        OptionType: { BOOLEAN: "boolean" },
        definePluginSettings(definitions) {
            return {
                definitions,
                store: Object.fromEntries(Object.entries(definitions).map(([key, value]) => [key, value.default])),
            };
        },
        UserStore: {
            getCurrentUser: () => user,
            addChangeListener: listener => listeners.add(listener),
            removeChangeListener: listener => listeners.delete(listener),
        },
        findByPropsLazy: () => new Proxy({}, {
            get(_, name) {
                if (enumThrows) throw Error("module not loaded");
                return enumReady && name === "NAGBAR_NOTICE_PREMIUM_PROMO" ? 42 : undefined;
            },
        }),
        createAndAppendStyle() {
            const style = { textContent: "", removed: false, remove() { this.removed = true; } };
            styles.push(style);
            return style;
        },
        managedStyleRootNode: {},
        getIntlMessage(key) {
            return `translated:${key}`;
        },
        getIntlMessageFromHash(hash) {
            return `translated:${hash}`;
        },
        findGroupChildrenByChildId: (id, groups) => groups.find(group => group.some(child => child?.props?.id === id)),
    };
    runInNewContext(source, context, { filename: "index.ts" });
    return {
        plugin: context.plugin,
        alerts,
        styles,
        listeners,
        setUser(value) {
            user = value;
            for (const listener of listeners) listener();
        },
        setEnum(ready, throws = false) {
            enumReady = ready;
            enumThrows = throws;
        },
    };
}

function applyPatch(fixture, patch) {
    if (patch.predicate && !patch.predicate()) return fixture;
    const replacements = Array.isArray(patch.replacement) ? patch.replacement : [patch.replacement];
    return replacements.reduce((patched, replacement) => {
        if (replacement.predicate && !replacement.predicate()) return patched;
        const match = new RegExp(replacement.match.source.replaceAll("\\i", "[A-Za-z_$][\\w$]*"), replacement.match.flags);
        assert.match(patched, match);
        const result = patched.replace(match, replacement.replace);
        assert.notEqual(result, patched);
        return result;
    }, fixture);
}

test("subscription changes immediately restore controls and stopping removes the listener", () => {
    const harness = loadPlugin();
    harness.plugin.start();
    const style = harness.styles[0];
    assert.doesNotMatch(style.textContent, /nitro_panel|premiumSubscribeButton_/);
    harness.setUser({ premiumType: 0 });
    assert.match(style.textContent, /nitro_panel/);
    assert.match(style.textContent, /premiumSubscribeButton_/);
    harness.setUser({ premiumType: 2 });
    assert.doesNotMatch(style.textContent, /nitro_panel|premiumSubscribeButton_/);
    harness.setUser({ premiumType: 0 });
    assert.match(style.textContent, /nitro_panel/);
    harness.plugin.stop();
    assert.equal(style.removed, true);
    assert.equal(harness.listeners.size, 0);
});

test("live settings update only the selected rules", () => {
    const { plugin, styles } = loadPlugin();
    plugin.start();
    assert.match(styles[0].textContent, /questEmbedCard_/);
    plugin.settings.store.questEmbeds = false;
    plugin.settings.definitions.questEmbeds.onChange();
    assert.doesNotMatch(styles[0].textContent, /questEmbedCard_/);
    assert.match(styles[0].textContent, /upsellBanner_/);
});

test("a failed lazy enum lookup is retried after its module loads", () => {
    const harness = loadPlugin();
    assert.equal(harness.plugin.isSuppressedDC(42), false);
    harness.setEnum(true);
    assert.equal(harness.plugin.isSuppressedDC(42), true);
    assert.equal(harness.plugin.isSuppressedDC(43), false);
});

test("an unresolved enum does not cache an empty set", () => {
    const harness = loadPlugin();
    harness.setEnum(false);
    assert.equal(harness.plugin.isSuppressedDC(42), false);
    harness.setEnum(true);
    assert.equal(harness.plugin.isSuppressedDC(42), true);
});

test("unknown notices and payment warnings remain visible", () => {
    const { plugin } = loadPlugin();
    for (const type of ["PREMIUM_MISSING_PAYMENT", "PREMIUM_PAST_DUE_1", "PREMIUM_UNCANCEL", "NEW_NOTICE_TYPE"]) {
        const notice = { type };
        assert.equal(plugin.isPromoNotice(type), false);
        assert.equal(plugin.filterNotice(notice), notice);
    }
    assert.equal(plugin.filterNotice({ type: "PREMIUM_PROMO" }), null);
    assert.equal(plugin.filterNotice(null), null);
    assert.equal(plugin.filterNotice(undefined), undefined);
});

test("the notice-store patches skip promotions without hiding payment warnings", () => {
    const { plugin } = loadPlugin();
    const storePatch = plugin.patches.find(patch => patch.find === 'displayName="NoticeStore"');
    const noticePatch = plugin.patches.find(patch => patch.find === ".APP_NOTICE_VIEWED,");

    const priorityLoop = '(function(order,notices){for(let[index,type]of order.entries())if(type!=="GLOBAL_BANNER_PREVIEW"){if(null==notices[type])continue;if(notices[type].predicate())return notices[type]}})';
    const selectNotice = runInNewContext(applyPatch(priorityLoop, storePatch), { $self: plugin });
    const promotion = { type: "PREMIUM_PROMO", predicate: () => true };
    const paymentWarning = { type: "PREMIUM_MISSING_PAYMENT", predicate: () => true };
    const ineligibleWarning = { type: "PREMIUM_PAST_DUE_1", predicate: () => false };
    const unknownNotice = { type: "NEW_NOTICE_TYPE", predicate: () => true };
    const notices = {
        PREMIUM_PROMO: promotion,
        PREMIUM_MISSING_PAYMENT: paymentWarning,
        PREMIUM_PAST_DUE_1: ineligibleWarning,
        NEW_NOTICE_TYPE: unknownNotice,
    };

    assert.equal(selectNotice(["PREMIUM_PROMO", "PREMIUM_MISSING_PAYMENT"], notices), paymentWarning);
    assert.equal(selectNotice(["PREMIUM_PAST_DUE_1"], notices), undefined);
    assert.equal(selectNotice(["PREMIUM_PAST_DUE_1", "NEW_NOTICE_TYPE"], notices), unknownNotice);

    const getNotice = "(()=>store.getNotice())";
    const paymentResult = runInNewContext(applyPatch(getNotice, noticePatch), {
        $self: plugin,
        store: { getNotice: () => paymentWarning },
    });
    const promotionResult = runInNewContext(applyPatch(getNotice, noticePatch), {
        $self: plugin,
        store: { getNotice: () => promotion },
    });
    assert.equal(paymentResult(), paymentWarning);
    assert.equal(promotionResult(), null);

    plugin.settings.store.nagbars = false;
    assert.equal(applyPatch(priorityLoop, storePatch), priorityLoop);
    assert.equal(applyPatch(getNotice, noticePatch), getNotice);
});

test("collectibles are kept while the account is unknown and for full Nitro subscribers", () => {
    const harness = loadPlugin();
    const items = [{ id: "owned-decoration" }];
    assert.equal(harness.plugin.filterNitroCollectibles(items), items);
    for (const premiumType of [0, 1, 3]) {
        harness.setUser({ premiumType });
        assert.equal(harness.plugin.filterNitroCollectibles(items).length, 0);
    }
    harness.setUser({ premiumType: 2 });
    assert.equal(harness.plugin.filterNitroCollectibles(items), items);
});

test("the server context-menu patch keeps unrelated actions", () => {
    const { plugin } = loadPlugin();
    const group = [{ props: { id: "settings" } }, { props: { id: "premium-subscribe" } }, null];
    plugin.contextMenus["guild-header-popout"]([group]);
    assert.deepEqual(group, [{ props: { id: "settings" } }, null]);
    plugin.contextMenus["guild-header-popout"]([group]);
    plugin.settings.store.boostMenuItem = false;
    const boost = { props: { id: "premium-subscribe" } };
    group.push(boost);
    plugin.contextMenus["guild-header-popout"]([group]);
    assert.equal(group.at(-1), boost);
});

test("the roadblock patch preserves subscriber actions", () => {
    const harness = loadPlugin();
    const patch = harness.plugin.patches.find(patch => patch.find === '?"free_trial":');
    const fixture = '[{text:"close"},{text:a,variant:"expressive",size:"md",onClick:async e=>{await c(),d(e)},icon:i.x}]';
    const patched = applyPatch(fixture, patch);
    const render = () => runInNewContext(patched, { $self: harness.plugin, a: "Nitro", i: { x: "icon" } });
    assert.equal(render().length, 2);
    harness.setUser({ premiumType: 0 });
    assert.equal(render().length, 1);
    harness.setUser({ premiumType: 2 });
    assert.equal(render().length, 2);
});

test("server-cap invite gates retain a visible limit explanation", () => {
    const harness = loadPlugin();
    const patch = harness.plugin.patches.find(patch => patch.find === '"nitro-guild-cap-upsell"');
    const identifier = "[A-Za-z_$][\\w$]*";
    const match = new RegExp(patch.replacement.match.source.replaceAll("\\i", identifier), patch.replacement.match.flags);
    const openerFixture = "function(e){let{onCloseCallback:c,analyticsLocations:a,...p}=e;(0,m.mM)(async()=>null,{onCloseCallback:c})}";
    assert.match(openerFixture, match);
    const patchedOpener = openerFixture.replace(match, patch.replacement.replace);
    assert.notEqual(patchedOpener, openerFixture);

    let joins = 0;
    let closes = 0;
    const openCap = runInNewContext(`(${patchedOpener})`, { $self: harness.plugin });
    const joinThroughInviteGate = guildCount => {
        if (guildCount >= 100) return openCap({ onCloseCallback: () => closes++ });
        joins++;
    };

    joinThroughInviteGate(100);
    assert.equal(harness.alerts.length, 1);
    assert.match(harness.alerts[0].body, /maximum number of servers/);
    assert.equal(joins, 0);
    harness.alerts[0].onConfirm();
    assert.equal(closes, 1);

    joinThroughInviteGate(99);
    assert.equal(harness.alerts.length, 1);
    assert.equal(joins, 1);
});

for (const [anchor, props] of [
    ['"buttonShineClassName"in', "subscriptionTier:t,onClick:n,size:a,postSuccessGuild:g"],
    [".disabled||!0===", "subscriptionTier:t,onClick:n,postSuccessGuild:g"],
]) {
    test(`the subscribe component keeps its hooks when subscription changes (${anchor})`, () => {
        const harness = loadPlugin();
        const patch = harness.plugin.patches.find(patch => patch.find === anchor);
        // Both current subscribe components call hooks before this outer render return.
        const fixture = `let Button=function(e){let{${props}}=e;hook();hook();return(0,i.jsx)(r.A,{onClick:n,subscriptionTier:t,postSuccessGuild:g,children:()=>null})};Button`;
        const patched = applyPatch(fixture, patch);
        let hookCalls = 0;
        const render = runInNewContext(patched, {
            $self: harness.plugin,
            hook() { hookCalls++; },
            i: { jsx: (_, props) => props },
            r: { A: "SubscribeButton" },
        });
        for (const premiumType of [undefined, 0, 2, 0]) {
            harness.setUser(premiumType == null ? undefined : { premiumType });
            hookCalls = 0;
            const rendered = render({ subscriptionTier: 2 });
            assert.equal(hookCalls, 2);
            assert.equal(rendered === null, premiumType === 0);
        }
    });
}

test("subscribeButtons controls activation of all three patches", () => {
    const harness = loadPlugin();
    const subscribeFixture = props => `let Button=function(e){let{${props}}=e;return(0,i.jsx)(r.A,{onClick:n,subscriptionTier:t,postSuccessGuild:g,children:()=>null})};Button`;
    const renderSubscribe = source => runInNewContext(source, {
        $self: harness.plugin,
        i: { jsx: (_, props) => props },
        r: { A: "SubscribeButton" },
    })({ subscriptionTier: 2 });
    const fixtures = [
        {
            patch: harness.plugin.patches.find(patch => patch.find === '"buttonShineClassName"in'),
            source: subscribeFixture("subscriptionTier:t,onClick:n,size:a,postSuccessGuild:g"),
            assertRemoved: source => assert.equal(renderSubscribe(source), null),
        },
        {
            patch: harness.plugin.patches.find(patch => patch.find === ".disabled||!0==="),
            source: subscribeFixture("subscriptionTier:t,onClick:n,postSuccessGuild:g"),
            assertRemoved: source => assert.equal(renderSubscribe(source), null),
        },
        {
            patch: harness.plugin.patches.find(patch => patch.find === '?"free_trial":'),
            source: '[{text:"close"},{text:a,variant:"expressive",size:"md",onClick:async e=>{await c(),d(e)},icon:i.x}]',
            assertRemoved: source => assert.equal(
                runInNewContext(source, { $self: harness.plugin, a: "Nitro", i: { x: "icon" } }).length,
                1,
            ),
        },
    ];

    harness.setUser({ premiumType: 0 });
    for (const { patch, source, assertRemoved } of fixtures) {
        const patched = applyPatch(source, patch);
        assert.notEqual(patched, source);
        assertRemoved(patched);
    }

    harness.plugin.settings.store.subscribeButtons = false;
    for (const { patch, source } of fixtures)
        assert.equal(applyPatch(source, patch), source);
});
