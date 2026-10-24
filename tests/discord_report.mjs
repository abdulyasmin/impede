// SPDX-License-Identifier: AGPL-3.0-or-later
// Checks impede against the Discord build discord.com serves today: the
// plugin's patches and finds through Vencord's reporter, and the CSS selectors
// of the theme and the plugin against the stylesheets and modules that build
// loads.
//
// Run from a Vencord checkout with impede in src/userplugins/impede:
//   pnpm buildReporter
//   CHROMIUM_BIN=/path/to/chromium node src/userplugins/impede/tests/discord_report.mjs
// Exits 1 when something no longer matches, 2 when the check could not finish.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const PLUGIN = "Impede";
const TIMEOUT_MS = 8 * 60_000;

const vencord = process.cwd();
const pup = createRequire(join(vencord, "package.json"))("puppeteer-core");
const plugin = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
const theme = readFileSync(new URL("../impede.theme.css", import.meta.url), "utf8");

// String arguments of the plugin's lazy finds, to pick its failures out of the reporter's.
const findArgs = [...plugin.matchAll(/find\w*Lazy\(([^)]*)\)/g)]
    .flatMap(([, args]) => [...args.matchAll(/"([^"]+)"/g)].map(m => m[1]));

// Selector text only: the theme without comments and declaration blocks, and the
// string literals in the plugin's HIDE_SELECTORS table.
let selectorText = theme.replace(/\/\*[\s\S]*?\*\//g, "");
while (/\{[^{}]*\}/.test(selectorText)) selectorText = selectorText.replace(/\{[^{}]*\}/g, ",");
const table = plugin.match(/^const HIDE_SELECTORS\b[\s\S]*?^\};/m)?.[0] ?? "";
selectorText += [...table.matchAll(/'([^']*)'|"([^"]*)"/g)].map(m => m[1] ?? m[2]).join(",");

// Every class, id and attribute value those selectors depend on.
const tokens = new Map();
for (const [selector, attr, value] of selectorText.matchAll(/\[([\w-]+)[*^$|~]?="([^"]*)"\]/g))
    if (attr !== "role") tokens.set(selector, { kind: attr === "class" ? "class" : "value", value });
const outsideAttributes = selectorText.replace(/\[[^\]]*\]/g, " ");
for (const [selector, prefix, name] of outsideAttributes.matchAll(/(?<![\w-])([.#])(-?[_a-zA-Z][\w-]*)/g))
    tokens.set(selector, { kind: prefix === "." ? "class" : "id", value: name });

const failures = { patches: [], starts: [], finds: [], selectors: [] };
let build = "unknown build";
let browser;

function stop(reason) {
    console.log(`impede: the check did not finish: ${reason}`);
    browser?.process()?.kill("SIGKILL");
    process.exit(2);
}
setTimeout(() => stop(`no result within ${TIMEOUT_MS / 60_000} minutes`), TIMEOUT_MS).unref();

// Vencord's reporter logs through console with "[Vencord]", a tag and a message,
// the same lines scripts/generateReport.ts parses. Messages are handled in the
// order they arrive, so "Finished test" is seen after every earlier failure.
const { promise: finished, resolve: finish } = Promise.withResolvers();
async function handle(e) {
    const args = await Promise.all(e.args().map(a => a.jsonValue().catch(() => undefined)));
    if (args[0] === "[REPORTER_META]") {
        build = `build ${args[1]?.buildNumber}`;
        return;
    }
    if (args[0] !== "[Vencord]") return;
    const [, tag, message = "", detail = ""] = args.map(a => typeof a === "string" ? a : "");
    let m;
    if (tag === "WebpackPatcher:" && (m = message.match(/^Patch by (.+?) (had no effect|errored|found no module) \(Module id is (.+?)\): (.+)/s)) && m[1] === PLUGIN)
        failures.patches.push(`${m[2]} (module ${m[3]}): ${m[4].split("\n")[0]}`);
    else if (tag === "PluginManager:" && message.startsWith(`Failed to start ${PLUGIN}\n`))
        failures.starts.push(message.trim());
    else if (tag === "Reporter:" && message === "Webpack Find Fail:" && findArgs.some(arg => detail.includes(`"${arg}"`)))
        failures.finds.push(detail);
    else if ((tag === "Reporter:" || tag === "LazyChunkLoader:") && message === "A fatal error occurred:")
        finish(`the reporter failed: ${e.text()}`);
    else if (tag === "Reporter:" && message === "Finished test")
        finish(null);
}

try {
    browser = await pup.launch({ headless: true, executablePath: process.env.CHROMIUM_BIN, args: ["--no-sandbox"] });
    const page = await browser.newPage();
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36");
    await page.setBypassCSP(true);

    let queue = Promise.resolve();
    page.on("console", e => {
        queue = queue.then(() => handle(e)).catch(err => finish(`could not read a console message: ${err.message}`));
    });

    await page.evaluateOnNewDocument(`
        if (location.host.endsWith("discord.com")) {
            ${readFileSync(join(vencord, "dist/browser.js"), "utf8")};
        }
    `);
    await page.goto("https://discord.com/login", { timeout: 120_000 });

    const error = await finished;
    if (error) stop(error);

    // The reporter has loaded every lazy chunk, so the page holds all of
    // Discord's stylesheets and module factories.
    const result = await page.evaluate(async (pluginName, tokens) => {
        const { wreq } = Vencord.Webpack;
        const modules = Object.values(wreq.m).map(String);
        const source = modules.join("\n");
        const classes = [];
        for (const sheet of document.styleSheets) {
            if (sheet.ownerNode?.tagName !== "LINK") continue;
            let text;
            try {
                text = Array.from(sheet.cssRules, r => r.cssText).join("\n");
            } catch {
                text = await fetch(sheet.href).then(r => r.text()).catch(() => "");
            }
            for (const [, name] of text.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) classes.push(name);
        }
        if (!classes.length || !modules.length)
            return { error: `the page had ${classes.length} classes and ${modules.length} modules` };
        const classNames = [...new Set(classes)].join(" ");

        // Vencord warns about a patch whose find matches no module, but not for
        // patches with all: true.
        const unmatched = Vencord.WebpackPatcher.patches
            .filter(p => p.plugin === pluginName && p.all)
            .filter(p => !modules.some(src => typeof p.find === "string" ? src.includes(p.find) : (p.find.lastIndex = 0, p.find.test(src))))
            .map(p => `found no module (all: true): ${p.find}`);

        // Menu item ids are the menu's navId and the item's id joined with "-",
        // so an id also counts as present when both halves appear as strings.
        const quoted = s => source.includes(`"${s}"`);
        const present = ({ kind, value }) =>
            source.includes(value)
            || kind === "class" && classNames.includes(value)
            || kind === "id" && value.split("-").some((_, i, parts) => i > 0 && quoted(parts.slice(0, i).join("-")) && quoted(parts.slice(i).join("-")));
        return { unmatched, missing: tokens.filter(([, token]) => !present(token)).map(([selector]) => selector) };
    }, PLUGIN, [...tokens]);
    if (result.error) stop(result.error);
    failures.patches.push(...result.unmatched);
    failures.selectors.push(...result.missing);
    await browser.close();
} catch (err) {
    stop(err.message);
}

const sections = [
    ["Patches that no longer apply", failures.patches],
    ["Plugin start failures", failures.starts],
    ["Webpack finds that failed", failures.finds],
    ["CSS selectors Discord no longer uses", failures.selectors],
];
const broken = sections.filter(([, list]) => list.length);
console.log(`impede on Discord ${build}: ${broken.length ? "problems found" : `all patches, finds and ${tokens.size} selector tokens still match`}`);
for (const [title, list] of broken) {
    console.log(`\n${title}:`);
    for (const item of list) console.log(`- ${item}`);
}
process.exit(broken.length ? 1 : 0);
