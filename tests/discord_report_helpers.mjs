// SPDX-License-Identifier: AGPL-3.0-or-later

export function extractFindArgs(plugin) {
    return [...plugin.matchAll(/find\w*Lazy\(([^)]*)\)/g)]
        .flatMap(([, args]) => [...args.matchAll(/"([^"]+)"/g)].map(match => match[1]));
}

export function extractSelectorTokens(plugin, theme) {
    let selectorText = theme.replace(/\/\*[\s\S]*?\*\//g, "");
    while (/\{[^{}]*\}/.test(selectorText)) selectorText = selectorText.replace(/\{[^{}]*\}/g, ",");
    const table = plugin.match(/^const HIDE_SELECTORS\b[\s\S]*?^\};/m)?.[0] ?? "";
    selectorText += [...table.matchAll(/'([^']*)'|"([^"]*)"/g)].map(match => match[1] ?? match[2]).join(",");

    const tokens = new Map();
    for (const [selector, attr, value] of selectorText.matchAll(/\[([\w-]+)[*^$|~]?="([^"]*)"\]/g))
        if (attr !== "role") tokens.set(selector, { kind: attr === "class" ? "class" : "value", value });
    const outsideAttributes = selectorText.replace(/\[[^\]]*\]/g, " ");
    for (const [selector, prefix, name] of outsideAttributes.matchAll(/(?<![\w-])([.#])(-?[_a-zA-Z][\w-]*)/g))
        tokens.set(selector, { kind: prefix === "." ? "class" : "id", value: name });
    return tokens;
}

export function createReporterState() {
    return {
        build: "unknown build",
        failures: { patches: [], starts: [], finds: [], selectors: [] },
    };
}

export function consumeReporterMessage(state, args, text, pluginName, findArgs) {
    if (args[0] === "[REPORTER_META]") {
        state.build = `build ${args[1]?.buildNumber}`;
        return null;
    }
    if (args[0] !== "[Vencord]") return null;
    const [, tag, message = "", detail = ""] = args.map(value => typeof value === "string" ? value : "");
    let match;
    if (tag === "WebpackPatcher:" && (match = message.match(/^Patch by (.+?) (had no effect|errored|found no module) \(Module id is (.+?)\): (.+)/s)) && match[1] === pluginName)
        state.failures.patches.push(`${match[2]} (module ${match[3]}): ${match[4].split("\n")[0]}`);
    else if (tag === "PluginManager:" && message.startsWith(`Failed to start ${pluginName}\n`))
        state.failures.starts.push(message.trim());
    else if (tag === "Reporter:" && message === "Webpack Find Fail:" && findArgs.some(arg => detail.includes(`"${arg}"`)))
        state.failures.finds.push(detail);
    else if ((tag === "Reporter:" || tag === "LazyChunkLoader:") && message === "A fatal error occurred:")
        return { finished: true, error: `the reporter failed: ${text}` };
    else if (tag === "Reporter:" && message === "Finished test")
        return { finished: true, error: null };
    return null;
}

// This function is also serialized into the browser page by discord_report.mjs.
// Keep it self-contained.
export function inspectCompatibility(pluginName, patches, modules, classNames, tokens) {
    const source = modules.join("\n");
    const classes = [...new Set(classNames)].join(" ");
    const unmatched = patches
        .filter(patch => patch.plugin === pluginName && patch.all)
        .filter(patch => !modules.some(module => {
            if (typeof patch.find === "string") return module.includes(patch.find);
            patch.find.lastIndex = 0;
            return patch.find.test(module);
        }))
        .map(patch => `found no module (all: true): ${patch.find}`);

    const quoted = value => source.includes(`"${value}"`);
    const present = ({ kind, value }) =>
        source.includes(value)
        || kind === "class" && classes.includes(value)
        || kind === "id" && value.split("-").some((_, index, parts) =>
            index > 0 && quoted(parts.slice(0, index).join("-")) && quoted(parts.slice(index).join("-")));
    const missing = tokens.filter(([, token]) => !present(token)).map(([selector]) => selector);
    return { unmatched, missing };
}

export function classifyReport(failures, { incomplete = false } = {}) {
    if (incomplete) return { kind: "incomplete", exitCode: 2 };
    const failed = Object.values(failures).some(list => list.length);
    return { kind: failed ? "compatibility-failure" : "clean", exitCode: failed ? 1 : 0 };
}
