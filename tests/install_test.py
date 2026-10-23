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
            with open(os.environ['IMPEDE_TEST_CALLS'], 'a') as log:
                log.write(json.dumps(['pnpm', command]) + '\\n')
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
                for _ in range(200):
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
                              text=True, capture_output=True, timeout=30)

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
        with subprocess.Popen(self.arguments(), env={**self.env, "IMPEDE_TEST_PAUSE": pause},
                              text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE) as first:
            try:
                for _ in range(100):
                    if Path(pause + ".ready").exists():
                        break
                    if first.poll() is not None:
                        self.fail("first updater failed: " + repr(first.communicate()))
                    time.sleep(0.05)
                else:
                    self.fail("first updater did not reach the build")
                second = self.run_installer()
                self.assertNotEqual(second.returncode, 0)
                self.assertIn("another install/update", second.stdout + second.stderr)
            finally:
                Path(pause + ".release").touch()
                stdout, stderr = first.communicate(timeout=20)
            self.assertEqual(first.returncode, 0, stdout + stderr)


class ShellInstallerTests(InstallerTests, unittest.TestCase):
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
