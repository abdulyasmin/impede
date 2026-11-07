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

import {
    classifyReport,
    consumeReporterMessage,
    createReporterState,
    extractFindArgs,
    extractSelectorTokens,
    inspectCompatibility,
} from "./discord_report_helpers.mjs";

const PLUGIN = "Impede";
const TIMEOUT_MS = 8 * 60_000;

let browser;

function stop(reason) {
    console.log(`impede: the check did not finish: ${reason}`);
    browser?.process()?.kill("SIGKILL");
    process.exit(2);
}
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
setTimeout(() => stop(`no result within ${TIMEOUT_MS / 60_000} minutes`), TIMEOUT_MS).unref();

let pup;
let vencord;
let findArgs;
let tokens;
let report;
let failures;
let browserBundle;
try {
    vencord = process.cwd();
    pup = createRequire(join(vencord, "package.json"))("puppeteer-core");
    const plugin = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
    const theme = readFileSync(new URL("../impede.theme.css", import.meta.url), "utf8");
    findArgs = extractFindArgs(plugin);
    tokens = extractSelectorTokens(plugin, theme);
    report = createReporterState();
    ({ failures } = report);
    browserBundle = readFileSync(join(vencord, "dist/browser.js"), "utf8");
    if (!browserBundle.includes(PLUGIN)) stop(`the browser bundle does not contain ${PLUGIN}`);
} catch (err) {
    stop(errorMessage(err));
}

// Vencord's reporter logs through console with "[Vencord]", a tag and a message,
// the same lines scripts/generateReport.ts parses. Messages are handled in the
// order they arrive, so "Finished test" is seen after every earlier failure.
const { promise: finished, resolve: finish } = Promise.withResolvers();
async function handle(e) {
    const args = await Promise.all(e.args().map(a => a.jsonValue().catch(() => undefined)));
    const result = consumeReporterMessage(report, args, e.text(), PLUGIN, findArgs);
    if (result?.finished) finish(result.error);
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
        globalThis.__impedeInspectCompatibility = ${inspectCompatibility.toString()};
        if (location.host.endsWith("discord.com")) {
            ${browserBundle};
        }
    `);
    await page.goto("https://discord.com/login", { timeout: 120_000 });

    const error = await finished;
    if (error) stop(error);

    // The reporter has loaded every lazy chunk, so the page holds all of
    // Discord's stylesheets and module factories.
    const result = await page.evaluate(async (pluginName, tokens) => {
        const plugins = Vencord.Plugins?.plugins;
        const plugin = plugins instanceof Map ? plugins.get(pluginName) : plugins?.[pluginName];
        if (!plugin) return { error: `${pluginName} is missing from Vencord's plugin registry` };
        const { wreq } = Vencord.Webpack;
        const modules = Object.values(wreq.m).map(String);
        const classes = [];
        for (const sheet of document.styleSheets) {
            if (sheet.ownerNode?.tagName !== "LINK") continue;
            let text;
            try {
                text = Array.from(sheet.cssRules, r => r.cssText).join("\n");
            } catch {
                let response;
                try {
                    response = await fetch(sheet.href);
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    throw new Error(`could not fetch stylesheet ${sheet.href}: ${message}`);
                }
                if (!response.ok) {
                    const status = [response.status, response.statusText].filter(Boolean).join(" ");
                    throw new Error(`could not fetch stylesheet ${sheet.href}: HTTP ${status || "error"}`);
                }
                try {
                    text = await response.text();
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    throw new Error(`could not read stylesheet ${sheet.href}: ${message}`);
                }
            }
            for (const [, name] of text.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) classes.push(name);
        }
        if (!classes.length || !modules.length)
            return { error: `the page had ${classes.length} classes and ${modules.length} modules` };
        return globalThis.__impedeInspectCompatibility(pluginName, Vencord.WebpackPatcher.patches, modules, classes, tokens);
    }, PLUGIN, [...tokens]);
    if (result.error) stop(result.error);
    failures.patches.push(...result.unmatched);
    failures.selectors.push(...result.missing);
    await browser.close();
} catch (err) {
    stop(errorMessage(err));
}

const sections = [
    ["Patches that no longer apply", failures.patches],
    ["Plugin start failures", failures.starts],
    ["Webpack finds that failed", failures.finds],
    ["CSS selectors Discord no longer uses", failures.selectors],
];
const broken = sections.filter(([, list]) => list.length);
console.log(`impede on Discord ${report.build}: ${broken.length ? "problems found" : `all patches, finds and ${tokens.size} selector tokens still match`}`);
for (const [title, list] of broken) {
    console.log(`\n${title}:`);
    for (const item of list) console.log(`- ${item}`);
}
process.exit(classifyReport(failures).exitCode);
