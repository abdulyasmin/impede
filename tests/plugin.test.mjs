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
    const context = {
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
    const match = new RegExp(patch.replacement.match.source.replaceAll("\\i", "[A-Za-z_$][\\w$]*"));
    const fixture = '[{text:"close"},{text:a,variant:"expressive",size:"md",onClick:async e=>{await c(),d(e)},icon:i.x}]';
    const patched = fixture.replace(match, patch.replacement.replace);
    assert.notEqual(patched, fixture);
    const render = () => runInNewContext(patched, { $self: harness.plugin, a: "Nitro", i: { x: "icon" } });
    assert.equal(render().length, 2);
    harness.setUser({ premiumType: 0 });
    assert.equal(render().length, 1);
    harness.setUser({ premiumType: 2 });
    assert.equal(render().length, 2);
});

for (const [anchor, props] of [
    ['"buttonShineClassName"in', "subscriptionTier:t,onClick:n,size:a,postSuccessGuild:g"],
    [".disabled||!0===", "subscriptionTier:t,onClick:n,postSuccessGuild:g"],
]) {
    test(`the subscribe component keeps its hooks when subscription changes (${anchor})`, () => {
        const harness = loadPlugin();
        const { replacement } = harness.plugin.patches.find(patch => patch.find === anchor);
        const match = new RegExp(replacement.match.source.replaceAll("\\i", "[A-Za-z_$][\\w$]*"));
        // Both current subscribe components call hooks before this outer render return.
        const fixture = `let Button=function(e){let{${props}}=e;hook();hook();return(0,i.jsx)(r.A,{onClick:n,subscriptionTier:t,postSuccessGuild:g,children:()=>null})};Button`;
        const patched = fixture.replace(match, replacement.replace);
        assert.notEqual(patched, fixture);
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
