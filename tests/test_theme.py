#!/usr/bin/env python3
"""Exercise the complete theme against synthetic DOMs in Chromium, without network access.

Run: CHROMIUM_BIN=/path/to/chromium python3 tests/test_theme.py
These fixtures check hiding boundaries; they do not establish current Discord compatibility.
"""

import html
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]


class ThemeTests(unittest.TestCase):
    def test_hiding_boundaries(self):
        browser = os.environ.get("CHROMIUM_BIN") or next(
            (path for name in ("chromium", "chromium-browser", "google-chrome", "chrome-headless-shell")
             if (path := shutil.which(name))), None
        )
        self.assertTrue(browser, "Set CHROMIUM_BIN to a Chromium executable")
        stylesheet = (ROOT / "impede.theme.css").read_text()
        # Count the rules independently so silently dropped invalid selectors fail the test.
        rule_count = len(re.findall(r"\{", re.sub(r"/\*.*?\*/", "", stylesheet, flags=re.S)))
        script = r"""
const results = [];
function check(name, passed) { results.push({name, passed}); }
check("all CSS rules parse", document.styleSheets[0].cssRules.length === RULE_COUNT);
function fixture(name, markup, hidden) {
    const host = document.createElement("section");
    host.innerHTML = markup;
    document.body.append(host);
    const target = host.querySelector("[data-target]");
    let actualHidden = false;
    for (let node = target; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        actualHidden ||= style.display === "none" || style.visibility === "hidden";
    }
    check(name, actualHidden === hidden);
    host.remove();
}
for (const suffix of ["_abc123", "__abc123"]) {
    const c = name => name + suffix;
    fixture("quest row " + suffix,
        '<ul><li data-target><div><a href="/quest-home">Quests</a></div></li></ul>', true);
    fixture("ordinary DM " + suffix,
        '<ul><li data-target><div><a href="/channels/@me/123">Friend</a></div></li></ul>', false);
    fixture("inline upsell " + suffix,
        `<div data-target class="${c("nitroUpsell")}">Get Nitro</div>`, true);
    fixture("premium promotion " + suffix,
        `<div data-target class="${c("notice")} ${c("colorPremium")}">Promotion</div>`, true);
    fixture("unknown dark notice " + suffix,
        `<div data-target class="${c("notice")}"><div class="${c("noticeContent")}">Account information</div></div>`, false);
    fixture("Meta Quest promotion " + suffix,
        `<div data-target class="${c("notice")}"><div class="${c("iconMetaQuest")}">Promotion</div></div>`, true);
    for (const color of ["colorWarning", "colorDanger"]) {
        for (const content of ["noticeContent", "iconMetaQuest", "premiumIcon"]) {
            fixture(`payment warning ${suffix} ${color} ${content}`,
                `<div data-target class="${c("notice")} ${c("colorPremium")} ${c(color)}"><div class="${c(content)}">Fix payment</div></div>`, false);
        }
        fixture(`partner icon in warning ${suffix} ${color}`,
            `<div data-target class="${c("notice")} ${c("colorPremium")} ${c(color)}"><div class="premiumIcon__7b750">Fix payment</div></div>`, false);
    }
    for (const wrap of [false, true]) {
        const icon = `<svg class="${c("premiumIcon")}"></svg>`;
        fixture(`subscription ending ${suffix} wrapper=${wrap}`,
            `<div data-target class="${c("notice")} ${c("colorPremium")}">${wrap ? "<div>" + icon + "</div>" : icon}<div class="${c("noticeContent")}">Your subscription ends soon</div></div>`, false);
    }
    fixture("ordinary main column " + suffix,
        `<div data-target><div class="${c("mainColumn")}">Profile details</div></div>`, false);
    fixture("ordinary content card " + suffix,
        `<div data-target class="${c("newContentCard")}">Account information</div>`, false);
    fixture("subscribe upsell " + suffix,
        `<button data-target><span class="${c("premiumSubscribeButton")}">Subscribe</span></button>`, true);
    fixture("billing settings " + suffix,
        '<ul><li data-target data-settings-sidebar-item="billing_panel">Billing</li></ul>', false);
    fixture("subscription settings " + suffix,
        '<ul><li data-target data-settings-sidebar-item="subscriptions_panel">Subscriptions</li></ul>', false);
}
fixture("keep Nitro in cancellation flow",
    '<div role="dialog"><button data-target data-mana-component="button"><svg><path d="M16.23 12c0 1.29-.95 2.25-2.22 2.25"></path></svg>Keep Nitro</button></div>', false);
fixture("unrelated modal stays visible",
    '<div data-target role="dialog"><button>Close</button></div>', false);
const output = document.createElement("pre");
output.id = "results";
output.textContent = JSON.stringify(results);
document.body.append(output);
""".replace("RULE_COUNT", str(rule_count))
        document = "<!doctype html><meta charset=utf-8><style>" + stylesheet + "</style><body><script>" + script + "</script>"
        with tempfile.TemporaryDirectory(prefix="impede-theme-test-") as tmp:
            page = Path(tmp) / "fixture.html"
            page.write_text(document)
            process = subprocess.Popen(
                [browser, "--headless", "--no-sandbox", "--disable-gpu",
                 "--disable-background-networking", "--disable-component-update",
                 "--no-first-run", "--no-default-browser-check",
                 "--host-resolver-rules=MAP * ~NOTFOUND",
                 "--user-data-dir=" + str(Path(tmp) / "profile"),
                 "--dump-dom", page.as_uri()],
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                start_new_session=os.name != "nt",
            )
            try:
                stdout, stderr = process.communicate(timeout=45)
            except subprocess.TimeoutExpired:
                if os.name == "nt":
                    process.kill()
                else:
                    os.killpg(process.pid, signal.SIGKILL)
                stdout, stderr = process.communicate()
                self.fail("Browser timed out: " + stderr[-3000:])
        self.assertEqual(process.returncode, 0, stderr[-3000:])
        output = re.search(r'<pre id="results">(.*?)</pre>', stdout, re.S)
        self.assertIsNotNone(output, "Browser did not finish the fixture: " + stderr[-3000:])
        results = json.loads(html.unescape(output.group(1)))
        self.assertGreater(len(results), 30)
        for test in results:
            with self.subTest(test["name"]):
                self.assertTrue(test["passed"])
        print(f"Checked {len(results)} theme boundaries in Chromium")


if __name__ == "__main__":
    unittest.main()
