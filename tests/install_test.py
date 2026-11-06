#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Offline installer regressions with real Node and mocked git/pnpm.

Run with python3 tests/install_test.py. Set IMPEDE_TEST_PWSH to a pwsh binary
to include portable PowerShell tests; Windows scheduling/injection still need
a Windows smoke test.
"""

import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import textwrap
import time
import unittest


ROOT = Path(__file__).resolve().parents[1]
PWSH = os.environ.get("IMPEDE_TEST_PWSH") or shutil.which("pwsh")
ARTIFACTS = (
    "patcher.js", "preload.js", "renderer.js", "renderer.css",
    "vencordDesktopMain.js", "vencordDesktopPreload.js",
    "vencordDesktopRenderer.js", "vencordDesktopRenderer.css",
)
INSTALLER_TIMEOUT = 30
STARTUP_TIMEOUT = 30
RELEASE_TIMEOUT = INSTALLER_TIMEOUT + 5


class InstallerTests:
    powershell = False

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="impede-install-test-")
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.checkout = self.base / "Vencord with spaces"
        self.plugin = self.checkout / "src/userplugins/impede"
        (self.checkout / ".git").mkdir(parents=True)
        (self.plugin / ".git").mkdir(parents=True)
        (self.checkout / "package.json").write_text(json.dumps({
            "name": "vencord", "packageManager": "pnpm@11.9.0",
        }))
        self.dist = self.checkout / "dist"
        self.dist.mkdir()
        for artifact in ARTIFACTS:
            (self.dist / artifact).write_text("old " + artifact)
        self.marker = self.dist / ".impede-build"
        self.marker.write_text("old-vencord\nold-impede\n")
        self.before = self.snapshot()
        self.bin = self.base / "bin"
        self.bin.mkdir()
        self.log = self.base / "calls.jsonl"
        self.env = os.environ.copy()
        self.env.update({
            "PATH": str(self.bin) + os.pathsep + self.env["PATH"],
            "IMPEDE_TEST_CALLS": str(self.log),
            "IMPEDE_TEST_ARTIFACTS": json.dumps(ARTIFACTS),
            "XDG_CONFIG_HOME": str(self.base / "config"),
            "APPDATA": str(self.base / "appdata"),
        })
        self.command("git", """
            import json, os, pathlib, sys
            args = sys.argv[1:]
            directory, command = pathlib.Path(args[1]), args[2]
            with open(os.environ['IMPEDE_TEST_CALLS'], 'a') as log:
                log.write(json.dumps(['git', str(directory), command]) + '\\n')
            if command == 'status':
                if os.environ.get('IMPEDE_TEST_DIRTY') == directory.name:
                    print(' M index.ts')
                if os.environ.get('IMPEDE_TEST_STATUS_FAIL'):
                    sys.exit(2)
            elif command == 'rev-parse':
                print('new-impede' if directory.name == 'impede' else 'new-vencord')
            elif command == 'pull' and directory.name == 'impede' and os.environ.get('IMPEDE_TEST_REPLACE_SCRIPT'):
                script = pathlib.Path(os.environ['IMPEDE_TEST_REPLACE_SCRIPT'])
                script.write_text(script.read_text() + "\\nprintf 'UNSAFE_RESUME\\\\n'\\n")
            elif command != 'pull':
                sys.exit('unexpected git command: ' + command)
        """)
        self.command("pnpm", """
            import json, os, pathlib, sys, time
            command = sys.argv[1]
            if command == '--version':
                print('11.9.0')
                sys.exit(0)
            call = ['pnpm', command]
            if os.environ.get('IMPEDE_TEST_RECORD_CWD'):
                call.append(str(pathlib.Path.cwd()))
            with open(os.environ['IMPEDE_TEST_CALLS'], 'a') as log:
                log.write(json.dumps(call) + '\\n')
            dist = pathlib.Path('dist')
            if (dist / '.impede-build').exists():
                sys.exit('build marker was not invalidated')
            if command == 'install':
                sys.exit(9 if os.environ.get('IMPEDE_TEST_FAIL_INSTALL') else 0)
            if command != 'build':
                sys.exit('unexpected pnpm command: ' + command)
            dist.mkdir(exist_ok=True)
            (dist / 'renderer.js').write_text('partial build')
            pause = os.environ.get('IMPEDE_TEST_PAUSE')
            if pause:
                pathlib.Path(pause + '.ready').touch()
                deadline = time.monotonic() + float(os.environ.get('IMPEDE_TEST_RELEASE_TIMEOUT', '10'))
                while time.monotonic() < deadline:
                    if pathlib.Path(pause + '.release').exists(): break
                    time.sleep(0.05)
                else: sys.exit('test timed out')
            if os.environ.get('IMPEDE_TEST_FAIL_BUILD'):
                sys.exit(7)
            for artifact in json.loads(os.environ['IMPEDE_TEST_ARTIFACTS']):
                if artifact == 'preload.js' and os.environ.get('IMPEDE_TEST_INCOMPLETE'):
                    continue
                (dist / artifact).write_text('new ' + artifact)
        """)
        self.command("systemctl", """
            import json, os, sys
            args = sys.argv[1:]
            with open(os.environ['IMPEDE_TEST_CALLS'], 'a') as log:
                log.write(json.dumps(['systemctl', *args]) + '\\n')
            if args == ['--user', 'show-environment'] and os.environ.get('IMPEDE_TEST_SYSTEMD_UNAVAILABLE'):
                sys.exit(1)
        """)

    def command(self, name, source):
        path = self.bin / name
        path.write_text("#!/usr/bin/env python3\n" + textwrap.dedent(source))
        path.chmod(0o755)

    def snapshot(self):
        return {str(p.relative_to(self.dist)): p.read_bytes()
                for p in self.dist.rglob("*") if p.is_file()}

    def arguments(self, mode="update", *options):
        if self.powershell:
            return [PWSH, "-NoProfile", "-File", str(ROOT / "install.ps1"),
                    mode, "-VencordDir", str(self.checkout), *options]
        return ["sh", str(ROOT / "install.sh"), mode,
                "--vencord-dir", str(self.checkout), *options]

    def run_installer(self, *args, **extra_env):
        return subprocess.run(self.arguments(*args), env={**self.env, **extra_env},
                              text=True, capture_output=True, timeout=INSTALLER_TIMEOUT)

    def calls(self):
        return [json.loads(line) for line in self.log.read_text().splitlines()] if self.log.exists() else []

    def test_failed_build_restores_all_previous_files_and_marker(self):
        result = self.run_installer(IMPEDE_TEST_FAIL_BUILD="1")
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(self.snapshot(), self.before)
        self.assertFalse(list(self.base.glob("*.impede-build*")))

    def test_failed_dependency_install_restores_marker(self):
        result = self.run_installer(IMPEDE_TEST_FAIL_INSTALL="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.snapshot(), self.before)
        self.assertNotIn(["pnpm", "build"], self.calls())

    def test_success_records_revisions_and_skips_next_build(self):
        result = self.run_installer()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(self.marker.read_text().splitlines(), ["new-vencord", "new-impede"])
        self.log.unlink()
        result = self.run_installer()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("Already up to date", result.stdout)
        self.assertFalse(any(call[0] == "pnpm" for call in self.calls()))

    def test_missing_artifact_rebuilds_even_with_matching_marker(self):
        self.marker.write_text("new-vencord\nnew-impede\n")
        (self.dist / "preload.js").unlink()
        result = self.run_installer()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn(["pnpm", "build"], self.calls())
        self.assertTrue((self.dist / "preload.js").is_file())

    def test_success_exit_without_complete_outputs_restores_previous_build(self):
        result = self.run_installer(IMPEDE_TEST_INCOMPLETE="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("required Vencord files", result.stdout + result.stderr)
        self.assertEqual(self.snapshot(), self.before)

    def test_dirty_plugin_stops_before_either_pull(self):
        result = self.run_installer(IMPEDE_TEST_DIRTY="impede")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("local changes", result.stdout + result.stderr)
        self.assertFalse(any(call[-1] == "pull" for call in self.calls()))
        self.assertEqual(self.snapshot(), self.before)

    def test_git_status_failure_stops_before_pull(self):
        result = self.run_installer(IMPEDE_TEST_STATUS_FAIL="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any(call[-1] == "pull" for call in self.calls()))

    def test_wrong_checkout_stops_before_pull(self):
        (self.checkout / "package.json").write_text('{"name":"different-project"}')
        result = self.run_installer()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("not a Vencord checkout", result.stdout + result.stderr)
        self.assertFalse(any(call[-1] == "pull" for call in self.calls()))

    def test_worktree_git_file_is_accepted(self):
        (self.checkout / ".git").rmdir()
        (self.checkout / ".git").write_text("gitdir: /test/worktree")
        (self.plugin / ".git").rmdir()
        (self.plugin / ".git").write_text("gitdir: /test/plugin-worktree")
        result = self.run_installer()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_concurrent_update_is_rejected(self):
        pause = str(self.base / "pause")
        first_env = {
            **self.env,
            "IMPEDE_TEST_PAUSE": pause,
            "IMPEDE_TEST_RELEASE_TIMEOUT": str(RELEASE_TIMEOUT),
        }
        with subprocess.Popen(self.arguments(), env=first_env,
                              text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE) as first:
            readiness_error = None
            try:
                deadline = time.monotonic() + STARTUP_TIMEOUT
                while time.monotonic() < deadline:
                    if Path(pause + ".ready").exists():
                        break
                    if first.poll() is not None:
                        readiness_error = "first updater exited before reaching the build"
                        break
                    time.sleep(0.05)
                else:
                    readiness_error = f"first updater did not reach the build within {STARTUP_TIMEOUT} seconds"
                if readiness_error is None:
                    second = self.run_installer()
                    self.assertNotEqual(second.returncode, 0)
                    self.assertIn("another install/update", second.stdout + second.stderr)
            finally:
                Path(pause + ".release").touch()
                try:
                    stdout, stderr = first.communicate(timeout=20)
                except subprocess.TimeoutExpired:
                    first.kill()
                    stdout, stderr = first.communicate()
                    self.fail("first updater did not exit after release\n"
                              f"stdout:\n{stdout}\nstderr:\n{stderr}")
            if readiness_error is not None:
                self.fail(f"{readiness_error}\nstdout:\n{stdout}\nstderr:\n{stderr}")
            self.assertEqual(first.returncode, 0, stdout + stderr)


class ShellInstallerTests(InstallerTests, unittest.TestCase):
    def prepare_injection_mocks(self):
        scripts = self.checkout / "scripts"
        scripts.mkdir()
        (scripts / "runInstaller.mjs").write_text("""
            import { appendFileSync } from "node:fs";
            appendFileSync(process.env.IMPEDE_TEST_CALLS,
                JSON.stringify(["runInstaller", ...process.argv.slice(2)]) + "\\n");
        """)
        installer_dir = self.dist / "Installer"
        installer_dir.mkdir()
        installer = installer_dir / "VencordInstallerCli-linux"
        installer.write_text("""#!/usr/bin/env python3
import json, os, sys
with open(os.environ['IMPEDE_TEST_CALLS'], 'a') as log:
    log.write(json.dumps([
        'installer', *sys.argv[1:],
        os.environ.get('VENCORD_USER_DATA_DIR'),
        os.environ.get('VENCORD_DEV_INSTALL'),
    ]) + '\\n')
""")
        installer.chmod(0o755)
        for command in ("sudo", "doas", "run0", "pkexec"):
            self.command(command, """
                import json, os, sys
                with open(os.environ['IMPEDE_TEST_CALLS'], 'a') as log:
                    log.write(json.dumps(['unexpected elevation', *sys.argv]) + '\\n')
                sys.exit(1)
            """)

    @unittest.skipUnless(sys.platform.startswith("linux"), "shell injection fixture is Linux-only")
    def test_explicit_discord_injection_without_controlling_terminal(self):
        self.prepare_injection_mocks()
        discord = self.base / "Discord without installation"
        result = subprocess.run(
            self.arguments("plugin", "--discord", str(discord)),
            env=self.env,
            text=True,
            capture_output=True,
            timeout=INSTALLER_TIMEOUT,
            start_new_session=True,
        )

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn(["runInstaller", "--", "--version"], self.calls())
        self.assertIn([
            "installer", "--install", "--location", str(discord),
            str(self.checkout), "1",
        ], self.calls())
        self.assertFalse(any(call[0] == "unexpected elevation" for call in self.calls()))

    @unittest.skipUnless(sys.platform.startswith("linux"), "shell injection fixture is Linux-only")
    def test_interactive_discord_injection_requires_controlling_terminal(self):
        self.prepare_injection_mocks()
        result = subprocess.run(
            self.arguments("plugin"),
            env=self.env,
            text=True,
            capture_output=True,
            timeout=INSTALLER_TIMEOUT,
            start_new_session=True,
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("a controlling terminal is required to choose a Discord install",
                      result.stdout + result.stderr)
        self.assertFalse(any(call[0] == "installer" for call in self.calls()))
        self.assertFalse(any(call[0] == "unexpected elevation" for call in self.calls()))

    @unittest.skipUnless(sys.platform.startswith("linux"), "systemd scheduling is Linux-only")
    def test_linux_schedule_reschedule_and_unschedule(self):
        checkout = self.base / 'Vencord with spaces "quotes" 100% $cash'
        self.checkout.rename(checkout)
        self.checkout = checkout
        self.plugin = checkout / "src/userplugins/impede"
        self.dist = checkout / "dist"
        self.marker = self.dist / ".impede-build"
        self.marker.write_text("new-vencord\nnew-impede\n")

        result = self.run_installer("update", "--schedule")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

        unit_dir = Path(self.env["XDG_CONFIG_HOME"]) / "systemd/user"
        service = unit_dir / "impede-update.service"
        timer = unit_dir / "impede-update.timer"
        node_dir = subprocess.check_output(
            ["node", "-p", 'require("path").dirname(process.execPath)'],
            env=self.env,
            text=True,
        ).strip()

        def unit_escape(value):
            return value.replace("\\", "\\\\").replace('"', '\\"').replace("%", "%%")

        def exec_escape(value):
            return unit_escape(value).replace("$", "$$")

        expected_path = node_dir + os.pathsep + self.env["PATH"]
        expected_service = f'''[Unit]
Description=Update impede and Vencord, and rebuild Vencord

[Service]
Type=oneshot
Environment="PATH={unit_escape(expected_path)}"
ExecStart=/bin/sh "{exec_escape(str(self.plugin / "install.sh"))}" update --vencord-dir "{exec_escape(str(checkout))}"
'''
        expected_timer = '''[Unit]
Description=Update impede every day

[Timer]
OnCalendar=daily
RandomizedDelaySec=1h
Persistent=true

[Install]
WantedBy=timers.target
'''
        self.assertEqual(service.read_text(), expected_service)
        self.assertEqual(timer.read_text(), expected_timer)
        self.assertEqual(expected_path.split(os.pathsep)[0], node_dir)
        systemctl_calls = [call for call in self.calls() if call[0] == "systemctl"]
        self.assertEqual(systemctl_calls, [
            ["systemctl", "--user", "show-environment"],
            ["systemctl", "--user", "daemon-reload"],
            ["systemctl", "--user", "enable", "--now", "impede-update.timer"],
        ])

        service.write_text("stale service\n")
        timer.write_text("stale timer\n")
        call_offset = len(self.calls())
        result = self.run_installer("update", "--schedule")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(service.read_text(), expected_service)
        self.assertEqual(timer.read_text(), expected_timer)
        new_calls = self.calls()[call_offset:]
        self.assertEqual([call for call in new_calls if call[0] == "systemctl"], [
            ["systemctl", "--user", "show-environment"],
            ["systemctl", "--user", "daemon-reload"],
            ["systemctl", "--user", "enable", "--now", "impede-update.timer"],
        ])

        result = self.run_installer("update", "--unschedule")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertFalse(service.exists())
        self.assertFalse(timer.exists())
        systemctl_calls = [call for call in self.calls() if call[0] == "systemctl"]
        self.assertEqual(systemctl_calls[-2:], [
            ["systemctl", "--user", "disable", "--now", "impede-update.timer"],
            ["systemctl", "--user", "daemon-reload"],
        ])

        call_count = len(systemctl_calls)
        result = self.run_installer("update", "--unschedule")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("No update is scheduled", result.stdout)
        self.assertEqual(len([call for call in self.calls() if call[0] == "systemctl"]), call_count)

        result = self.run_installer("update", "--schedule", IMPEDE_TEST_SYSTEMD_UNAVAILABLE="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("scheduling needs systemd", result.stdout + result.stderr)
        self.assertFalse(service.exists())
        self.assertFalse(timer.exists())

    @unittest.skipUnless(sys.platform.startswith("linux"), "systemd scheduling is Linux-only")
    def test_failed_reschedule_preserves_existing_units(self):
        self.marker.write_text("new-vencord\nnew-impede\n")
        result = self.run_installer("update", "--schedule")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

        unit_dir = Path(self.env["XDG_CONFIG_HOME"]) / "systemd/user"
        service = unit_dir / "impede-update.service"
        timer = unit_dir / "impede-update.timer"
        installed = {path: path.read_bytes() for path in (service, timer)}
        self.command("cat", """
            import pathlib, sys
            if len(sys.argv) > 1:
                sys.stdout.buffer.write(pathlib.Path(sys.argv[1]).read_bytes())
                sys.exit(0)
            sys.stdout.write("partial definition\\n")
            sys.exit(23)
        """)
        call_offset = len(self.calls())

        result = self.run_installer("update", "--schedule")

        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual({path: path.read_bytes() for path in (service, timer)}, installed)
        self.assertEqual(set(unit_dir.iterdir()), set(installed))
        systemctl_calls = [call for call in self.calls()[call_offset:]
                           if call[0] == "systemctl"]
        self.assertEqual(systemctl_calls, [
            ["systemctl", "--user", "show-environment"],
        ])

    @unittest.skipUnless(sys.platform.startswith("linux"), "systemd scheduling is Linux-only")
    def test_linux_schedule_rejects_newlines_before_writing_units(self):
        checkout = self.base / "Vencord with\nnewline"
        self.checkout.rename(checkout)
        self.checkout = checkout
        self.plugin = checkout / "src/userplugins/impede"
        self.dist = checkout / "dist"
        self.marker = self.dist / ".impede-build"
        self.marker.write_text("new-vencord\nnew-impede\n")

        result = self.run_installer("update", "--schedule")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("paths containing newlines", result.stdout + result.stderr)
        unit_dir = Path(self.env["XDG_CONFIG_HOME"]) / "systemd/user"
        self.assertFalse((unit_dir / "impede-update.service").exists())
        self.assertFalse((unit_dir / "impede-update.timer").exists())
        self.assertFalse(any(call[0] == "systemctl" for call in self.calls()))

    def test_directory_is_not_accepted_as_a_build_output(self):
        self.marker.write_text("new-vencord\nnew-impede\n")
        output = self.dist / "preload.js"
        output.unlink()
        output.mkdir()
        (output / "keep.txt").write_text("preserve unexpected data")
        result = self.run_installer()
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("Already up to date", result.stdout)
        self.assertEqual((output / "keep.txt").read_text(), "preserve unexpected data")

    def test_term_signal_restores_build_and_releases_lock(self):
        pause = str(self.base / "pause")
        with subprocess.Popen(self.arguments(), env={**self.env, "IMPEDE_TEST_PAUSE": pause},
                              text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                              start_new_session=True) as process:
            try:
                for _ in range(100):
                    if Path(pause + ".ready").exists():
                        break
                    if process.poll() is not None:
                        self.fail("updater failed: " + repr(process.communicate()))
                    time.sleep(0.05)
                else:
                    self.fail("updater did not reach the build")
                os.killpg(process.pid, signal.SIGTERM)
                process.communicate(timeout=5)
            finally:
                if process.poll() is None:
                    os.killpg(process.pid, signal.SIGTERM)
                    process.communicate(timeout=5)
        self.assertNotEqual(process.returncode, 0)
        self.assertEqual(self.snapshot(), self.before)
        self.assertFalse(Path(str(self.checkout) + ".impede-lock").exists())

    def test_self_update_does_not_resume_reading_modified_script(self):
        script = self.base / "install.sh"
        shutil.copyfile(ROOT / "install.sh", script)
        result = subprocess.run(["sh", str(script), "update", "--vencord-dir", str(self.checkout)],
                                env={**self.env, "IMPEDE_TEST_REPLACE_SCRIPT": str(script)},
                                text=True, capture_output=True, timeout=20)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertNotIn("UNSAFE_RESUME", result.stdout + result.stderr)
        self.assertIn("UNSAFE_RESUME", script.read_text())

    def test_vesktop_invalid_json_is_not_overwritten(self):
        script = re.search(r"node -e '(.*?)' \"\$dir/state.json\"", (ROOT / "install.sh").read_text(), re.S).group(1)
        state = self.base / "state.json"
        for invalid in ("{broken", "null", "[]"):
            with self.subTest(invalid=invalid):
                state.write_text(invalid)
                result = subprocess.run(["node", "-e", script, str(state), str(self.dist)],
                                        text=True, capture_output=True, timeout=10)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(state.read_text(), invalid)
        state.write_text('{"otherSetting":true}')
        subprocess.run(["node", "-e", script, str(state), str(self.dist)], check=True)
        self.assertEqual(json.loads(state.read_text()), {"otherSetting": True, "vencordDir": str(self.dist)})
        self.assertFalse(list(self.base.glob("state.json.*.tmp")))


@unittest.skipUnless(PWSH, "pwsh not found; set IMPEDE_TEST_PWSH to test PowerShell")
class PowerShellInstallerTests(InstallerTests, unittest.TestCase):
    powershell = True

    def test_bracketed_checkout_path_builds_in_requested_directory(self):
        checkout = self.base / "Vencord [test]"
        self.checkout.rename(checkout)
        self.checkout = checkout
        self.plugin = checkout / "src/userplugins/impede"
        self.dist = checkout / "dist"
        self.marker = self.dist / ".impede-build"

        for mode, options in (("plugin", ("-NoInject",)), ("update", ())):
            with self.subTest(mode=mode):
                if mode == "update":
                    (self.dist / "preload.js").unlink()
                if self.log.exists():
                    self.log.unlink()
                result = self.run_installer(mode, *options, IMPEDE_TEST_RECORD_CWD="1")
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                pnpm_calls = [call for call in self.calls() if call[0] == "pnpm"]
                self.assertEqual([call[1] for call in pnpm_calls], ["install", "build"])
                self.assertEqual({call[2] for call in pnpm_calls}, {str(checkout)})

    def test_theme_replacement_and_temporary_file_cleanup(self):
        themes = self.base / "appdata/Vencord/themes"
        themes.mkdir(parents=True)
        target = themes / "impede.theme.css"
        for copy in (False, True, False):
            result = subprocess.run([PWSH, "-NoProfile", "-File", str(ROOT / "install.ps1"),
                                     "theme", *(["-Copy"] if copy else [])],
                                    env=self.env, text=True, capture_output=True, timeout=20)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            source = ROOT / ("impede.theme.css" if copy else "impede.online.theme.css")
            self.assertEqual(target.read_bytes(), source.read_bytes())
            self.assertEqual(list(themes.iterdir()), [target])

    @unittest.skipIf(hasattr(os, "geteuid") and os.geteuid() == 0, "root bypasses file permissions")
    def test_theme_staging_failure_preserves_existing_copy(self):
        themes = self.base / "appdata/Vencord/themes"
        themes.mkdir(parents=True)
        target = themes / "impede.theme.css"
        target.write_text("previous theme")
        themes.chmod(0o555)
        try:
            result = subprocess.run([PWSH, "-NoProfile", "-File", str(ROOT / "install.ps1"), "theme"],
                                    env=self.env, text=True, capture_output=True, timeout=20)
        finally:
            themes.chmod(0o755)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(target.read_text(), "previous theme")
        self.assertEqual(list(themes.iterdir()), [target])

    def test_vesktop_invalid_json_is_not_overwritten(self):
        state = self.base / "appdata/vesktop/state.json"
        state.parent.mkdir(parents=True)
        for invalid in ("{broken", "null", "[]"):
            with self.subTest(invalid=invalid):
                state.write_text(invalid)
                result = self.run_installer("plugin", "-Vesktop")
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(state.read_text(), invalid)
        state.write_text('{"otherSetting":true}')
        result = self.run_installer("plugin", "-Vesktop")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(json.loads(state.read_text()), {"otherSetting": True, "vencordDir": str(self.dist)})
        self.assertFalse(list(state.parent.glob("state.json.*.tmp")))


if __name__ == "__main__":
    unittest.main(verbosity=2)
