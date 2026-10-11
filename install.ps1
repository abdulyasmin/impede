# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Installs impede on Windows, as a Vencord userplugin or as a CSS theme.
# Run it again to update. macOS and Linux use install.sh.
#
#   powershell -ExecutionPolicy Bypass -File install.ps1 plugin [-VencordDir DIR] [-Discord PATH] [-Vesktop] [-NoInject]
#   powershell -ExecutionPolicy Bypass -File install.ps1 theme
#
# plugin  Build Vencord from source with impede in it, then patch Discord.
#   -VencordDir  Vencord checkout to use, cloned if missing (default: ~\Vencord)
#   -Discord     Discord install to patch, instead of choosing from a list
#   -Vesktop     Point Vesktop at the build instead of patching Discord
#   -NoInject    Build only
# theme   Copy impede.theme.css into the themes folder of each client mod found:
#         Vencord, Vesktop, Equicord, Equibop and BetterDiscord.

param(
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidateSet("plugin", "theme")]
    [string]$Mode,
    [string]$VencordDir = (Join-Path $HOME "Vencord"),
    [string]$Discord,
    [switch]$Vesktop,
    [switch]$NoInject
)

$ErrorActionPreference = "Stop"

$RepoUrl = "https://forgejo.causticpotato.org/abdulyasmin/impede.git"
$MirrorUrl = "https://github.com/abdulyasmin/impede.git"
$VencordUrl = "https://github.com/Vendicated/Vencord.git"
$ThemeUrl = "https://raw.githubusercontent.com/abdulyasmin/impede/main/impede.theme.css"
$MinNode = 22

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

# Vencord's scripts call pnpm by name, so a missing pnpm gets a shim on PATH that runs the
# version pinned in Vencord's package.json through npx.
function Initialize-Pnpm {
    if (Have pnpm) { return }
    $pm = node -p "require(process.argv[1]).packageManager.split('+')[0]" (Join-Path $VencordDir "package.json")
    $shim = Join-Path ([IO.Path]::GetTempPath()) "impede-pnpm"
    New-Item -ItemType Directory -Force -Path $shim | Out-Null
    Set-Content -Encoding Ascii -Path (Join-Path $shim "pnpm.cmd") -Value "@npx --yes $pm %*"
    $env:Path = "$shim;$env:Path"
    Say "pnpm not found; running $pm through npx"
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
    $env:VENCORD_USER_DATA_DIR = $VencordDir
    $env:VENCORD_DEV_INSTALL = "1"
    try {
        Run $bin @installArgs
    } finally {
        Remove-Item Env:VENCORD_USER_DATA_DIR, Env:VENCORD_DEV_INSTALL
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
    $script = "const fs = require('fs'), [file, dist] = process.argv.slice(1); let state = {}; " +
        "try { state = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {} " +
        "state.vencordDir = dist; fs.writeFileSync(file, JSON.stringify(state, null, 4));"
    Run node -e $script (Join-Path $dir "state.json") $dist
    Say "Set Vesktop's Vencord location to $dist"
}

function Install-Plugin {
    Test-Tools
    $script:VencordDir = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($VencordDir)
    Sync-Repo $VencordDir $VencordUrl
    $pkg = Join-Path $VencordDir "package.json"
    if (-not (Test-Path -LiteralPath $pkg) -or (node -p "require(process.argv[1]).name" $pkg) -ne "vencord") {
        Fail "$VencordDir is not a Vencord checkout"
    }
    $userplugins = Join-Path $VencordDir "src\userplugins"
    New-Item -ItemType Directory -Force -Path $userplugins | Out-Null
    Sync-Repo (Join-Path $userplugins "impede") $RepoUrl $MirrorUrl

    Push-Location $VencordDir
    try {
        Initialize-Pnpm
        Say "Installing Vencord's dependencies"
        Run pnpm install --frozen-lockfile
        Say "Building Vencord"
        Run pnpm build

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

function Install-Theme {
    $src = Join-Path ([IO.Path]::GetTempPath()) "impede.theme.css"
    $local = if ($PSScriptRoot) { Join-Path $PSScriptRoot "impede.theme.css" } else { $null }
    if ($local -and (Test-Path -LiteralPath $local)) {
        Copy-Item -LiteralPath $local -Destination $src -Force
    } else {
        Say "Downloading impede.theme.css"
        [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -UseBasicParsing -Uri $ThemeUrl -OutFile $src
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
        Copy-Item -LiteralPath $src -Destination (Join-Path $themes "impede.theme.css") -Force
        Say "$($client.Key): $themes\impede.theme.css"
        $count++
    }
    Remove-Item -LiteralPath $src
    if ($count -eq 0) { Fail "no Vencord, Vesktop, Equicord, Equibop or BetterDiscord settings folder found" }
    Say "Done. Switch impede on in Settings > Themes."
}

try {
    if ($Mode -eq "plugin") { Install-Plugin } else { Install-Theme }
} catch {
    Write-Host "error: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
