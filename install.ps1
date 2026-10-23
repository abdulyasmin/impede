# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Installs impede on Windows, as a Vencord userplugin or as a CSS theme, and updates the
# plugin. macOS and Linux use install.sh.
#
#   powershell -ExecutionPolicy Bypass -File install.ps1 plugin [-VencordDir DIR] [-Discord PATH] [-Vesktop] [-NoInject] [-Schedule]
#   powershell -ExecutionPolicy Bypass -File install.ps1 update [-VencordDir DIR] [-Schedule] [-Unschedule] [-Log FILE]
#   powershell -ExecutionPolicy Bypass -File install.ps1 theme [-Copy]
#
# plugin  Build Vencord from source with impede in it, then patch Discord.
#   -VencordDir  Vencord checkout to use, cloned if missing (default: ~\Vencord)
#   -Discord     Discord install to patch, instead of choosing from a list
#   -Vesktop     Point Vesktop at the build instead of patching Discord
#   -NoInject    Build only
#   -Schedule    Also update every day, as update -Schedule does
# update  Pull Vencord and impede, and rebuild Vencord if either changed. Discord stays
#         patched and is not touched.
#   -VencordDir  Vencord checkout to update (default: ~\Vencord)
#   -Schedule    Also run this every day, as the Task Scheduler task "impede update"
#   -Unschedule  Remove that task
#   -Log         Also write the output to this file, replacing it; the task logs to
#                %LOCALAPPDATA%\impede-update.log
# theme   Install impede in the themes folder of each client mod found: Vencord, Vesktop,
#         Equicord, Equibop and BetterDiscord. The installed file loads the current theme
#         from GitHub Pages each time Discord starts.
#   -Copy        Copy the whole theme instead, to edit it or to work without GitHub Pages.
#                Run this again to update it.

param(
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidateSet("plugin", "update", "theme")]
    [string]$Mode,
    [string]$VencordDir = (Join-Path $HOME "Vencord"),
    [string]$Discord,
    [switch]$Vesktop,
    [switch]$NoInject,
    [switch]$Schedule,
    [switch]$Unschedule,
    [string]$Log,
    [switch]$Copy
)

$ErrorActionPreference = "Stop"

$RepoUrl = "https://forgejo.causticpotato.org/abdulyasmin/impede.git"
$MirrorUrl = "https://github.com/abdulyasmin/impede.git"
$VencordUrl = "https://github.com/Vendicated/Vencord.git"
$RawUrl = "https://raw.githubusercontent.com/abdulyasmin/impede/main"
$MinNode = 22
$TaskName = "impede update"
$OriginalPath = $env:Path
$PnpmShim = $null
$UpdateLock = $null
$UpdateLockPath = $null
$BuildArtifacts = @("patcher.js", "preload.js", "renderer.js", "renderer.css", "vencordDesktopMain.js",
    "vencordDesktopPreload.js", "vencordDesktopRenderer.js", "vencordDesktopRenderer.css")

function Say([string]$Message) { Write-Host "==> $Message" }
function Fail([string]$Message) { throw $Message }
function Have([string]$Name) { [bool](Get-Command $Name -ErrorAction SilentlyContinue) }

# Native commands do not stop the script on failure, so check each exit code.
function Run {
    $file = $args[0]
    $rest = @($args | Select-Object -Skip 1)
    & $file @rest
    if ($LASTEXITCODE -ne 0) { Fail "$file $($rest -join ' ') failed with exit code $LASTEXITCODE" }
}

function Test-Tools {
    if (-not (Have git)) { Fail "git is not installed: winget install Git.Git" }
    if (-not (Have node)) { Fail "Node.js $MinNode or newer is not installed: winget install OpenJS.NodeJS.LTS" }
    $major = [int](node -p "process.versions.node.split('.')[0]")
    if ($major -lt $MinNode) { Fail "Node.js $MinNode or newer is needed, found $(node --version)" }
}

# Vencord's scripts call pnpm by name. If the installed version differs from its pin,
# put a shim on PATH that runs the pinned version through npx.
function Initialize-Pnpm {
    $pm = Run node -p "require(process.argv[1]).packageManager.split('+')[0]" (Join-Path $VencordDir "package.json")
    if ($pm -notmatch '^pnpm@[0-9][a-zA-Z0-9.+-]*$') { Fail "unexpected package manager: $pm" }
    if ((Have pnpm) -and (pnpm --version) -eq $pm.Substring(5)) { return }
    if (-not (Have npx)) { Fail "npx is needed to run the pinned $pm version" }
    $shim = Join-Path ([IO.Path]::GetTempPath()) ("impede-pnpm-" + [Guid]::NewGuid())
    New-Item -ItemType Directory -Path $shim | Out-Null
    $script:PnpmShim = $shim
    Set-Content -Encoding Ascii -Path (Join-Path $shim "pnpm.cmd") -Value "@npx --yes $pm %*"
    $env:Path = "$shim;$env:Path"
    Say "Running the pinned $pm through npx"
}

function Lock-Update {
    $script:UpdateLockPath = "$VencordDir.impede-lock"
    [IO.Directory]::CreateDirectory((Split-Path $VencordDir)) | Out-Null
    try {
        $script:UpdateLock = [IO.File]::Open($UpdateLockPath, [IO.FileMode]::OpenOrCreate,
            [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    } catch {
        Fail "another install/update may be running, or the lock is not writable: $UpdateLockPath"
    }
}

function Test-Checkout([string]$Dir) {
    $item = Get-Item -LiteralPath $Dir -Force -ErrorAction SilentlyContinue
    if (-not $item) { return }
    if ($item.LinkType) { Fail "$Dir is a link; replace it with a clone" }
    if (-not (Test-Path -LiteralPath (Join-Path $Dir ".git"))) { Fail "$Dir exists but is not a git checkout" }
    if (Run git -C $Dir status --porcelain) { Fail "$Dir has local changes; commit or stash them before updating" }
}

function Test-Vencord {
    $pkg = Join-Path $VencordDir "package.json"
    if (-not (Test-Path -LiteralPath $pkg) -or (Run node -p "require(process.argv[1]).name" $pkg) -ne "vencord") {
        Fail "$VencordDir is not a Vencord checkout"
    }
    $dist = Get-Item -LiteralPath (Join-Path $VencordDir "dist") -Force -ErrorAction SilentlyContinue
    if ($dist -and ($dist.LinkType -or -not $dist.PSIsContainer)) { Fail "$VencordDir\dist must be a directory, not a link or file" }
}

function Sync-Repo([string]$Dir, [string]$Url, [string]$Fallback) {
    $item = Get-Item -LiteralPath $Dir -Force -ErrorAction SilentlyContinue
    if ($item -and $item.LinkType) {
        Fail "$Dir is a link; Vencord's build cannot resolve imports through one. Replace it with a clone."
    } elseif (Test-Path -LiteralPath (Join-Path $Dir ".git")) {
        Say "Updating $Dir"
        Run git -C $Dir pull --ff-only
    } elseif ($item) {
        Fail "$Dir exists but is not a git checkout"
    } else {
        Say "Cloning $Url into $Dir"
        & git clone $Url $Dir
        if ($LASTEXITCODE -ne 0) {
            if (-not $Fallback) { Fail "git clone $Url failed" }
            Run git clone $Fallback $Dir
        }
    }
}

function Invoke-Inject {
    Say "Downloading Vencord's installer"
    # Quoted, or PowerShell drops the -- that runInstaller.mjs looks for.
    Run node scripts/runInstaller.mjs '--' --version
    $bin = Join-Path $VencordDir "dist\Installer\VencordInstallerCli.exe"
    if (-not (Test-Path -LiteralPath $bin)) { Fail "Vencord's installer did not download" }

    $installArgs = @("--install")
    if ($Discord) { $installArgs += @("--location", $Discord) }

    # The same environment pnpm inject sets: patch Discord to load this checkout's dist folder.
    # The installer closes Discord before patching it.
    Say "Patching Discord"
    $oldUserData = $env:VENCORD_USER_DATA_DIR
    $oldDevInstall = $env:VENCORD_DEV_INSTALL
    $env:VENCORD_USER_DATA_DIR = $VencordDir
    $env:VENCORD_DEV_INSTALL = "1"
    try {
        Run $bin @installArgs
    } finally {
        $env:VENCORD_USER_DATA_DIR = $oldUserData
        $env:VENCORD_DEV_INSTALL = $oldDevInstall
    }
}

function Set-VesktopDir {
    $dir = Join-Path $env:APPDATA "vesktop"
    if (-not (Test-Path -LiteralPath $dir)) {
        Fail "no Vesktop settings folder found; start Vesktop once, quit it, and run this again"
    }
    if (Get-Process -Name vesktop -ErrorAction SilentlyContinue) {
        Fail "Vesktop is running; quit it first, or it overwrites the setting on exit"
    }
    $dist = Join-Path $VencordDir "dist"
    $script = "const fs = require('fs'), crypto = require('crypto'), [file, dist] = process.argv.slice(1); let state = {}; " +
        "try { state = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; } " +
        "if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('Invalid Vesktop state object'); " +
        "state.vencordDir = dist; const temp = file + '.' + crypto.randomUUID() + '.tmp'; " +
        "try { fs.writeFileSync(temp, JSON.stringify(state, null, 4), { flag: 'wx', mode: 0o600 }); fs.renameSync(temp, file); } " +
        "finally { fs.rmSync(temp, { force: true }); }"
    Run node -e $script (Join-Path $dir "state.json") $dist
    Say "Set Vesktop's Vencord location to $dist"
}

# The commits of Vencord and impede in the checkout, one per line.
function Get-Revisions {
    $plugin = Join-Path $VencordDir "src\userplugins\impede"
    (Run git -C $VencordDir rev-parse HEAD), (Run git -C $plugin rev-parse HEAD) -join "`n"
}

# Records the commits it built in dist, so update can tell when there is nothing new to build.
# Runs in the Vencord checkout.
function Build-Vencord {
    Initialize-Pnpm
    $revision = Get-Revisions
    $dist = Join-Path $VencordDir "dist"
    $backup = "$VencordDir.impede-build-$([Guid]::NewGuid())"
    New-Item -ItemType Directory -Path $backup | Out-Null
    $savedDist = Join-Path $backup "dist"
    $pending = $false
    try {
        if (Test-Path -LiteralPath $dist) { Copy-Item -LiteralPath $dist -Destination $savedDist -Recurse -Force }
        $pending = $true
        $marker = Join-Path $dist ".impede-build"
        if (Test-Path -LiteralPath $marker) { Remove-Item -LiteralPath $marker -Force }
        Say "Installing Vencord's dependencies"
        Run pnpm install --frozen-lockfile
        # Do not accept an old output when a successful build omits one of its files.
        foreach ($artifact in $BuildArtifacts) {
            $output = Join-Path $dist $artifact
            if (Test-Path -LiteralPath $output) { Remove-Item -LiteralPath $output -Force }
        }
        Say "Building Vencord"
        Run pnpm build
        if (-not (Test-BuildComplete)) { Fail "build did not produce all required Vencord files" }
        if ((Get-Revisions) -ne $revision) { Fail "checkout changed during the build; retry the update" }
        Set-Content -LiteralPath (Join-Path $dist ".impede-build") -Value $revision
        $pending = $false
    } finally {
        if ($pending) {
            Say "Build failed; restoring the previous dist folder"
            try {
                if (Test-Path -LiteralPath $dist) { Remove-Item -LiteralPath $dist -Recurse -Force }
                if (Test-Path -LiteralPath $savedDist) { Move-Item -LiteralPath $savedDist -Destination $dist }
            } catch {
                Fail "restore failed; previous build is in $backup. $($_.Exception.Message)"
            }
        }
        Remove-Item -LiteralPath $backup -Recurse -Force
    }
}

function Test-BuildComplete {
    foreach ($artifact in $BuildArtifacts) {
        $file = Get-Item -LiteralPath (Join-Path $VencordDir "dist\$artifact") -ErrorAction SilentlyContinue
        if (-not $file -or $file.PSIsContainer -or $file.Length -eq 0) { return $false }
    }
    return $true
}

# Runs update every day from the copy of this script in the impede checkout. conhost --headless
# keeps a console window from opening each time the task runs, but it also hides the exit code
# from Task Scheduler, so the task writes a log instead.
function Register-Update {
    $script = Join-Path $VencordDir "src\userplugins\impede\install.ps1"
    $shell = (Get-Process -Id $PID).Path
    $conhost = Join-Path $env:SystemRoot "System32\conhost.exe"
    $logFile = Join-Path $env:LOCALAPPDATA "impede-update.log"
    $arguments = "--headless `"$shell`" -NoProfile -ExecutionPolicy Bypass -File `"$script`" update " +
        "-VencordDir `"$($VencordDir.TrimEnd('\'))`" -Log `"$logFile`""
    $action = New-ScheduledTaskAction -Execute $conhost -Argument $arguments
    $trigger = New-ScheduledTaskTrigger -Daily -At 12:00
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RunOnlyIfNetworkAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings `
        -Description "Updates impede and Vencord, and rebuilds Vencord" -Force | Out-Null
    Say "Scheduled a daily update with the Task Scheduler task `"$TaskName`". Its log: $logFile"

    # The task gets the PATH saved in the registry, not this shell's.
    $saved = ([Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
        [Environment]::GetEnvironmentVariable("Path", "User")) -split ";" | ForEach-Object { $_.TrimEnd("\") }
    $nodeDir = Split-Path (Get-Command node).Source
    if ($saved -notcontains $nodeDir.TrimEnd("\")) {
        Write-Host "warning: $nodeDir is not on the PATH saved in Windows, so the task will not find node." -ForegroundColor Yellow
        Write-Host "Install Node.js with winget install OpenJS.NodeJS.LTS, or add that folder to your PATH." -ForegroundColor Yellow
    }
}

function Unregister-Update {
    if (-not (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue)) {
        Say "No update is scheduled"
        return
    }
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Say "Removed the scheduled update"
}

function Install-Plugin {
    Test-Tools
    $script:VencordDir = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($VencordDir)
    Lock-Update
    Test-Checkout $VencordDir
    Test-Checkout (Join-Path $VencordDir "src\userplugins\impede")
    if (Test-Path -LiteralPath $VencordDir) { Test-Vencord }
    Sync-Repo $VencordDir $VencordUrl
    Test-Vencord
    $userplugins = Join-Path $VencordDir "src\userplugins"
    New-Item -ItemType Directory -Force -Path $userplugins | Out-Null
    Sync-Repo (Join-Path $userplugins "impede") $RepoUrl $MirrorUrl

    Push-Location $VencordDir
    try {
        Build-Vencord
        if ($Schedule) { Register-Update }

        if ($Vesktop) {
            Set-VesktopDir
            Say "Done. Start Vesktop and enable Impede in Settings > Vencord > Plugins."
        } elseif (-not $NoInject) {
            Invoke-Inject
            Say "Done. Start Discord and enable Impede in Settings > Vencord > Plugins."
        } else {
            Say "Built $VencordDir\dist. Run this again without -NoInject to patch Discord."
        }
    } finally {
        Pop-Location
    }
}

function Update-Plugin {
    if ($Unschedule) {
        Unregister-Update
        return
    }
    Test-Tools
    $script:VencordDir = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($VencordDir)
    Lock-Update
    $plugin = Join-Path $VencordDir "src\userplugins\impede"
    if (-not (Test-Path -LiteralPath (Join-Path $plugin ".git"))) {
        Fail "impede is not installed in $VencordDir; run install.ps1 plugin first"
    }
    Test-Checkout $VencordDir
    Test-Checkout $plugin
    Test-Vencord
    Sync-Repo $VencordDir $VencordUrl
    Sync-Repo $plugin $RepoUrl

    $built = (Get-Content -LiteralPath (Join-Path $VencordDir "dist\.impede-build") -ErrorAction SilentlyContinue) -join "`n"
    if ((Test-BuildComplete) -and (Get-Revisions) -eq $built) {
        Say "Already up to date"
    } else {
        Push-Location $VencordDir
        try {
            Build-Vencord
        } finally {
            Pop-Location
        }
        Say "Updated. Restart Discord to use the new build."
    }
    if ($Schedule) { Register-Update }
}

function Install-Theme {
    $file = if ($Copy) { "impede.theme.css" } else { "impede.online.theme.css" }
    $src = [IO.Path]::GetTempFileName()
    try {
        $local = if ($PSScriptRoot) { Join-Path $PSScriptRoot $file } else { $null }
        if ($local -and (Test-Path -LiteralPath $local)) {
            Copy-Item -LiteralPath $local -Destination $src -Force
        } else {
            Say "Downloading $file"
            [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
            Invoke-WebRequest -UseBasicParsing -Uri "$RawUrl/$file" -OutFile $src
        }

        $clients = [ordered]@{
            "Vencord" = "Vencord"
            "Vesktop" = "vesktop"
            "Equicord" = "Equicord"
            "Equibop" = "equibop"
            "BetterDiscord" = "BetterDiscord"
        }
        $count = 0
        foreach ($client in $clients.GetEnumerator()) {
            $dir = Join-Path $env:APPDATA $client.Value
            if (-not (Test-Path -LiteralPath $dir)) { continue }
            $themes = Join-Path $dir "themes"
            New-Item -ItemType Directory -Force -Path $themes | Out-Null
            $destination = Join-Path $themes "impede.theme.css"
            $staged = Join-Path $themes (".impede-" + [Guid]::NewGuid() + ".tmp")
            try {
                [IO.File]::Copy($src, $staged, $false)
                if (Test-Path -LiteralPath $destination) {
                    [IO.File]::Replace($staged, $destination, [NullString]::Value)
                } else {
                    [IO.File]::Move($staged, $destination)
                }
            } finally {
                if (Test-Path -LiteralPath $staged) { Remove-Item -LiteralPath $staged -Force }
            }
            Say "$($client.Key): $themes\impede.theme.css"
            $count++
        }
    } finally {
        Remove-Item -LiteralPath $src -Force
    }
    if ($count -eq 0) { Fail "no Vencord, Vesktop, Equicord, Equibop or BetterDiscord settings folder found" }
    if ($Copy) {
        Say "Done. Switch impede on in Settings > Themes. Run this again to update it."
    } else {
        Say "Done. Switch impede on in Settings > Themes. It updates itself each time Discord starts."
    }
}

if ($Log) { Start-Transcript -Path $Log | Out-Null }
try {
    switch ($Mode) {
        "plugin" { Install-Plugin }
        "update" { Update-Plugin }
        "theme" { Install-Theme }
    }
} catch {
    Write-Host "error: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
} finally {
    if ($UpdateLock) {
        $UpdateLock.Dispose()
        # Leave the empty file in place: deleting it after releasing the handle can race
        # with another updater that has already acquired it.
    }
    $env:Path = $OriginalPath
    if ($PnpmShim) { Remove-Item -LiteralPath $PnpmShim -Recurse -Force }
    if ($Log) { Stop-Transcript | Out-Null }
}
