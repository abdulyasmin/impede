#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
"""macOS-only checks for scheduling, theme installation and Vesktop settings.

Run: python3 tests/macos_test.py [repository]

All files and the launchd label are temporary. HOME and existing jobs remain
unchanged. The scheduled script only records its arguments and PATH.

Without a GUI session, a separate copy of the generated plist uses the native
user domain and LimitLoadToSessionType=Background. The original plist and the
installer's requested GUI arguments are still checked. That adaptation tests
launchd execution in an SSH session, not a logged-in GUI session.
"""
import json
import os
from pathlib import Path
import plistlib
import shlex
import shutil
import subprocess
import sys
import tempfile
import time
import uuid

if sys.platform != "darwin":
    print("SKIP macOS tests: this host is not macOS")
    raise SystemExit(0)
if len(sys.argv) > 2:
    raise SystemExit("Usage: python3 tests/macos_test.py [repository]")
repo = Path(sys.argv[1]).resolve() if len(sys.argv) == 2 else Path(__file__).resolve().parents[1]
launchctl = shutil.which("launchctl")
node = shutil.which("node")
if not launchctl or not node:
    raise SystemExit("macOS tests need launchctl and Node.js on PATH")
uid = os.getuid()
gui_available = subprocess.run([launchctl, "print", "gui/%d" % uid], capture_output=True).returncode == 0
domain = ("gui/" if gui_available else "user/") + str(uid)
label = "org.causticpotato.impede.test." + uuid.uuid4().hex
passed = []

def check(name, condition):
    if not condition:
        raise AssertionError(name)
    passed.append(name)
    print("PASS " + name, flush=True)

with tempfile.TemporaryDirectory(prefix="impede-macos-check-") as temp:
    base = Path(temp)
    checkout = base / 'Vencord & <xml> "quotes" $dollar'
    plugin = checkout / "src/userplugins/impede"
    plugin.mkdir(parents=True)
    support = base / "Application Support & <xml>"
    support.mkdir()
    config = base / "Launch Agents & <xml>"
    config.mkdir()
    plist = config / (label + ".plist")
    log = base / 'Logs & <xml>' / "test.log"
    result = base / "scheduled-result.json"
    calls = base / "launchctl-calls.jsonl"
    fakebin = base / "bin"
    fakebin.mkdir()
    # Record the requested GUI domain; SSH-only sessions use the actual user domain.
    # A separate plist copy uses the Background session only when no GUI domain exists.
    wrapper = fakebin / "launchctl"
    wrapper.write_text("#!" + sys.executable + "\n" +
        "import json, os, plistlib, sys\n" +
        "args = sys.argv[1:]\n" +
        "with open(" + repr(str(calls)) + ", 'a') as f: f.write(json.dumps(args) + '\\n')\n" +
        "args = [a.replace(" + repr("gui/" + str(uid)) + ", " + repr(domain) + ", 1) for a in args]\n" +
        "if " + repr(not gui_available) + " and args[0] == 'bootstrap':\n" +
        "    with open(args[-1], 'rb') as f: definition = plistlib.load(f)\n" +
        "    definition['LimitLoadToSessionType'] = 'Background'\n" +
        "    adapted = args[-1] + '.background.plist'\n" +
        "    with open(adapted, 'wb') as f: plistlib.dump(definition, f)\n" +
        "    args[-1] = adapted\n" +
        "os.execv(" + repr(launchctl) + ", [" + repr(launchctl) + "] + args)\n")
    wrapper.chmod(0o755)
    # Test the stopped-client configuration path without inspecting or controlling real apps.
    pgrep = fakebin / "pgrep"
    pgrep.write_text("#!/bin/sh\nexit 1\n")
    pgrep.chmod(0o755)
    env = os.environ.copy()
    env.update({"PATH": str(fakebin) + os.pathsep + env["PATH"],
                "IMPEDE_TEST_VENCORD": str(checkout), "IMPEDE_TEST_LABEL": label,
                "IMPEDE_TEST_PLIST": str(plist), "IMPEDE_TEST_LOG": str(log),
                "IMPEDE_TEST_SUPPORT": str(support)})
    # Redirect only data destinations in this temporary copy, then invoke real functions.
    # Production install.sh remains unchanged and HOME keeps its real value.
    source = (repo / "install.sh").read_text()
    assert source.count('log="$HOME/Library/Logs/impede-update.log"') == 1
    source = source.replace('log="$HOME/Library/Logs/impede-update.log"', 'log="$IMPEDE_TEST_LOG"')
    source = source.replace('$HOME/Library/Application Support', '$IMPEDE_TEST_SUPPORT')
    end = 'main "$@"; exit $?'
    assert source.count(end) == 1
    source = source.replace(end, '''vencord=$IMPEDE_TEST_VENCORD
AGENT_LABEL=$IMPEDE_TEST_LABEL
AGENT_PLIST=$IMPEDE_TEST_PLIST
case $1 in
    schedule) schedule_updates ;;
    unschedule) unschedule_updates ;;
    theme) shift; theme "$@" ;;
    vesktop) point_vesktop ;;
esac
exit $?
''')
    harness = base / "harness.sh"
    harness.write_text(source)
    for filename in ("impede.theme.css", "impede.online.theme.css"):
        shutil.copyfile(repo / filename, base / filename)
    # launchd runs this stub, which only records its arguments and PATH.
    stub = plugin / "install.sh"
    record = "const fs=require('fs');fs.writeFileSync(process.argv[1],JSON.stringify({argv:process.argv.slice(2),path:process.env.PATH}));"
    stub.write_text("#!/bin/sh\nexec " + shlex.quote(node) + " -e " + shlex.quote(record) + " " + shlex.quote(str(result)) + ' "$@"\n')
    stub.chmod(0o755)

    def run(*args, success=True):
        completed = subprocess.run(["/bin/sh", str(harness), *args], env=env,
                                   capture_output=True, text=True, timeout=20)
        if success and completed.returncode:
            diagnostics = [completed.stdout, completed.stderr,
                           "native domain: " + domain,
                           "requested action: " + repr(args)]
            if plist.exists():
                diagnostics.append("generated plist:\n" + plist.read_text())
                lint = subprocess.run(["plutil", "-lint", str(plist)], capture_output=True, text=True)
                diagnostics.append("plutil exit=%s:\n%s%s" % (lint.returncode, lint.stdout, lint.stderr))
                details = subprocess.run(["ls", "-lde", str(plist), str(plist.parent), str(stub), str(log.parent)], capture_output=True, text=True)
                diagnostics.append("ownership/modes:\n" + details.stdout + details.stderr)
            if calls.exists():
                diagnostics.append("launchctl requests:\n" + calls.read_text())
            raise AssertionError("\n".join(diagnostics))
        return completed

    def wait_result():
        deadline = time.monotonic() + 10
        while not result.exists() and time.monotonic() < deadline:
            time.sleep(0.1)
        check("scheduled stub ran", result.exists())
        return json.loads(result.read_text())

    try:
        run("schedule")
        parsed = plistlib.loads(plist.read_bytes())
        check("plist parses with Apple plutil", subprocess.run(["plutil", "-lint", str(plist)], capture_output=True).returncode == 0)
        check("plist label is isolated", parsed["Label"] == label)
        check("original plist has no headless adaptation", "LimitLoadToSessionType" not in parsed)
        check("XML preserves argument boundaries", parsed["ProgramArguments"] == ["/bin/sh", str(stub), "update", "--vencord-dir", str(checkout)])
        check("log directory exists", log.parent.is_dir())
        check("log paths preserve XML characters", parsed["StandardOutPath"] == str(log) and parsed["StandardErrorPath"] == str(log))
        check("calendar runs at noon", parsed["StartCalendarInterval"] == {"Hour": 12, "Minute": 0} and parsed["RunAtLoad"] is True)
        check("job registered in native launchd", subprocess.run([launchctl, "print", domain + "/" + label], capture_output=True).returncode == 0)
        recorded = wait_result()
        check("launchd preserves arguments", recorded["argv"] == ["update", "--vencord-dir", str(checkout)])
        check("launchd receives generated PATH", recorded["path"] == parsed["EnvironmentVariables"]["PATH"])
        runtime_dir = subprocess.check_output([node, "-p", 'require("path").dirname(process.execPath)'], text=True).strip()
        check("scheduled PATH uses persistent Node directory", recorded["path"].split(os.pathsep)[0] == runtime_dir)
        recorded_calls = [json.loads(line) for line in calls.read_text().splitlines()]
        check("installer requests its GUI domain", recorded_calls[0] == ["bootout", "gui/%d/%s" % (uid, label)] and recorded_calls[1] == ["bootstrap", "gui/%d" % uid, str(plist)])
        result.unlink()
        run("schedule")
        check("rescheduling preserves generated plist", plistlib.loads(plist.read_bytes()) == parsed)
        wait_result()
        check("rescheduling replaces the existing agent", subprocess.run([launchctl, "print", domain + "/" + label], capture_output=True).returncode == 0)
        run("unschedule")
        check("unscheduling removes the plist", not plist.exists())
        check("unscheduling unloads launchd job", subprocess.run([launchctl, "print", domain + "/" + label], capture_output=True).returncode != 0)
        check("unscheduling is idempotent", "No update is scheduled" in run("unschedule").stdout)
        for client in ("Vencord", "vesktop", "Equicord", "equibop", "BetterDiscord"):
            (support / client).mkdir()
        for copy in (False, True, False):
            run("theme", *(["--copy"] if copy else []))
            content = (repo / ("impede.theme.css" if copy else "impede.online.theme.css")).read_bytes()
            for client in ("Vencord", "vesktop", "Equicord", "equibop", "BetterDiscord"):
                themes = support / client / "themes"
                check("theme %s copy=%s" % (client, copy), (themes / "impede.theme.css").read_bytes() == content and len(list(themes.iterdir())) == 1)
        state = support / "vesktop/state.json"
        for invalid in ("{broken", "null", "[]"):
            state.write_text(invalid)
            completed = run("vesktop", success=False)
            check("Vesktop preserves invalid state " + invalid, completed.returncode != 0 and state.read_text() == invalid)
        state.write_text('{"keepThis":true}')
        run("vesktop")
        check("Vesktop preserves unrelated settings", json.loads(state.read_text()) == {"keepThis": True, "vencordDir": str(checkout / "dist")})
        check("Vesktop removes staged settings file", not list(state.parent.glob("state.json.*.tmp")))
    finally:
        subprocess.run([launchctl, "bootout", domain + "/" + label], capture_output=True)
print(json.dumps({"passed": len(passed), "launchd_domain": domain, "gui_available": gui_available, "native_launchd": True, "background_session_adaptation": not gui_available}))
