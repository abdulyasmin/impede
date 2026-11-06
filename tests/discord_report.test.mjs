// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
    classifyReport,
    consumeReporterMessage,
    createReporterState,
    extractFindArgs,
    extractSelectorTokens,
    inspectCompatibility,
} from "./discord_report_helpers.mjs";

test("reporter messages retain only Impede compatibility failures", () => {
    const state = createReporterState();
    const findArgs = extractFindArgs('const module = findByPropsLazy("KEEP_ME", "ALSO_KEEP");');
    const consume = (args, text = args.join(" ")) => consumeReporterMessage(state, args, text, "Impede", findArgs);

    consume(["[REPORTER_META]", { buildNumber: 123456 }]);
    consume(["[Vencord]", "WebpackPatcher:", "Patch by Impede had no effect (Module id is 42): /missing/\nextra detail"]);
    consume(["[Vencord]", "WebpackPatcher:", "Patch by OtherPlugin errored (Module id is 9): unrelated"]);
    consume(["[Vencord]", "PluginManager:", "Failed to start OtherPlugin\nnot ours"]);
    consume(["[Vencord]", "PluginManager:", "Failed to start Impede\nstartup error"]);
    consume(["[Vencord]", "Reporter:", "Webpack Find Fail:", 'findByPropsLazy("IGNORE_ME")']);
    consume(["[Vencord]", "Reporter:", "Webpack Find Fail:", 'findByPropsLazy("KEEP_ME")']);

    assert.equal(state.build, "build 123456");
    assert.deepEqual(state.failures.patches, ["had no effect (module 42): /missing/"]);
    assert.deepEqual(state.failures.starts, ["Failed to start Impede\nstartup error"]);
    assert.deepEqual(state.failures.finds, ['findByPropsLazy("KEEP_ME")']);
});

test("fatal and completion messages finish with distinct results", () => {
    const fatalState = createReporterState();
    const fatal = consumeReporterMessage(
        fatalState,
        ["[Vencord]", "LazyChunkLoader:", "A fatal error occurred:"],
        "rendered fatal message",
        "Impede",
        [],
    );
    assert.deepEqual(fatal, { finished: true, error: "the reporter failed: rendered fatal message" });

    const completeState = createReporterState();
    const complete = consumeReporterMessage(
        completeState,
        ["[Vencord]", "Reporter:", "Finished test"],
        "finished",
        "Impede",
        [],
    );
    assert.deepEqual(complete, { finished: true, error: null });
});

test("missing reporter dependencies make the live reporter incomplete", t => {
    const fixture = mkdtempSync(join(tmpdir(), "impede-reporter-empty-test-"));
    t.after(() => rmSync(fixture, { recursive: true, force: true }));
    const reporter = fileURLToPath(new URL("./discord_report.mjs", import.meta.url));

    const result = spawnSync(process.execPath, [reporter], {
        cwd: fixture,
        encoding: "utf8",
    });

    assert.equal(result.status, 2, result.stdout + result.stderr);
    assert.match(result.stdout, /the check did not finish: Cannot find module 'puppeteer-core'/);
});

test("browser launch failures always make the live reporter incomplete", t => {
    const fixture = mkdtempSync(join(tmpdir(), "impede-reporter-test-"));
    t.after(() => rmSync(fixture, { recursive: true, force: true }));
    const moduleDir = join(fixture, "node_modules/puppeteer-core");
    mkdirSync(moduleDir, { recursive: true });
    writeFileSync(join(fixture, "package.json"), '{"private":true}\n');
    writeFileSync(join(moduleDir, "index.js"), `
        const { appendFileSync } = require("node:fs");
        module.exports = { launch() {
            appendFileSync(process.env.MOCK_LAUNCH_LOG, process.env.MOCK_REJECTION + "\\n");
            return Promise.reject(process.env.MOCK_REJECTION === "empty-error" ? new Error("") : "launch failed");
        } };
    `);
    const reporter = fileURLToPath(new URL("./discord_report.mjs", import.meta.url));
    const launchLog = join(fixture, "launches.log");

    for (const rejection of ["empty-error", "string"]) {
        const result = spawnSync(process.execPath, [reporter], {
            cwd: fixture,
            encoding: "utf8",
            env: { ...process.env, MOCK_LAUNCH_LOG: launchLog, MOCK_REJECTION: rejection },
        });
        assert.equal(result.status, 2, result.stdout + result.stderr);
        assert.match(result.stdout, /the check did not finish/);
    }
    assert.deepEqual(readFileSync(launchLog, "utf8").trim().split("\n"), ["empty-error", "string"]);
});

test("selector extraction and fixture inspection cover all:true patches and composed menu ids", () => {
    const theme = `
        /* ignored .commented-out */
        [class*="themeClass_"], #guild-header-popout-premium-subscribe,
        [data-testid="known-value"], [role="button"], .missingClass { display: none; }
    `;
    const plugin = `
const HIDE_SELECTORS = {
    one: ['[class*="pluginClass_"]', '#settings-entry', '[data-plugin="missing-plugin-value"]'],
};
`;
    const tokens = extractSelectorTokens(plugin, theme);
    assert.deepEqual(tokens.get('[class*="themeClass_"]'), { kind: "class", value: "themeClass_" });
    assert.equal(tokens.has('[role="button"]'), false);
    assert.deepEqual(tokens.get('[class*="pluginClass_"]'), { kind: "class", value: "pluginClass_" });
    assert.deepEqual(tokens.get("#settings-entry"), { kind: "id", value: "settings-entry" });
    assert.deepEqual(tokens.get('[data-plugin="missing-plugin-value"]'), {
        kind: "value",
        value: "missing-plugin-value",
    });
    assert.deepEqual(tokens.get("#guild-header-popout-premium-subscribe"), {
        kind: "id",
        value: "guild-header-popout-premium-subscribe",
    });

    const result = inspectCompatibility(
        "Impede",
        [
            { plugin: "Impede", all: true, find: "missing-all-patch" },
            { plugin: "Impede", all: true, find: /present-regex/ },
            { plugin: "Impede", all: false, find: "ignored-without-all" },
            { plugin: "OtherPlugin", all: true, find: "unrelated" },
        ],
        ['module with "guild-header-popout" and "premium-subscribe"', "known-value present-regex pluginClass_ settings-entry"],
        ["themeClass_hash"],
        [...tokens],
    );
    assert.deepEqual(result.unmatched, ["found no module (all: true): missing-all-patch"]);
    assert.deepEqual(result.missing, ['[data-plugin="missing-plugin-value"]', ".missingClass"]);
});

test("result classification distinguishes clean, broken and incomplete checks", () => {
    const clean = createReporterState().failures;
    const broken = createReporterState().failures;
    broken.selectors.push(".missing");

    assert.deepEqual(classifyReport(clean), { kind: "clean", exitCode: 0 });
    assert.deepEqual(classifyReport(broken), { kind: "compatibility-failure", exitCode: 1 });
    assert.deepEqual(classifyReport(clean, { incomplete: true }), { kind: "incomplete", exitCode: 2 });
});

test("the live workflow runs for reporter runtime changes only", () => {
    const root = dirname(fileURLToPath(import.meta.url));
    const workflow = readFileSync(join(root, "../.forgejo/workflows/report.yml"), "utf8");
    const pathLine = workflow.match(/^\s+paths:\s*\[([^\]]+)\]/m)?.[1] ?? "";
    const paths = [...pathLine.matchAll(/'([^']+)'/g)].map(match => match[1]);

    assert.ok(paths.includes("tests/discord_report_helpers.mjs"));
    assert.equal(paths.includes("tests/discord_report.test.mjs"), false);
    assert.equal(paths.includes("README.md"), false);
});
