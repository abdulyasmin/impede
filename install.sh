#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Installs impede on macOS or Linux, as a Vencord userplugin or as a CSS theme.
# Run it again to update. Windows uses install.ps1.

set -eu

REPO_URL="https://forgejo.causticpotato.org/abdulyasmin/impede.git"
MIRROR_URL="https://github.com/abdulyasmin/impede.git"
VENCORD_URL="https://github.com/Vendicated/Vencord.git"
THEME_URL="https://raw.githubusercontent.com/abdulyasmin/impede/main/impede.theme.css"
MIN_NODE=22

usage() {
    cat <<'EOF'
Usage: sh install.sh plugin [options]
       sh install.sh theme

plugin   Build Vencord from source with impede in it, then patch Discord.
         Running it again updates Vencord and impede.
  --vencord-dir DIR   Vencord checkout to use, cloned if missing (default: ~/Vencord)
  --discord PATH      Discord install to patch, instead of choosing from a list
  --vesktop           Point Vesktop at the build instead of patching Discord
  --no-inject         Build only

theme    Copy impede.theme.css into the themes folder of each client mod
         found: Vencord, Vesktop, Equicord, Equibop and BetterDiscord.
EOF
}

say() { printf '==> %s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

ask() {
    printf '%s [y/N] ' "$1"
    read -r answer </dev/tty || return 1
    case $answer in [yY]*) return 0 ;; *) return 1 ;; esac
}

download() {
    if have curl; then curl -fsSL "$1" -o "$2"
    elif have wget; then wget -qO "$2" "$1"
    else die "curl or wget is needed to download $1"
    fi
}

case $(uname -s) in
    Darwin) OS=mac ;;
    Linux) OS=linux ;;
    *) die "unsupported system $(uname -s); on Windows use install.ps1" ;;
esac

check_tools() {
    have git || die "git is not installed (macOS: xcode-select --install; Linux: your package manager)"
    have node || die "Node.js $MIN_NODE or newer is not installed: https://nodejs.org/en/download"
    major=$(node -p 'process.versions.node.split(".")[0]')
    [ "$major" -ge "$MIN_NODE" ] || die "Node.js $MIN_NODE or newer is needed, found $(node --version)"
}

# Vencord's scripts call pnpm by name, so a missing pnpm gets a shim on PATH that runs the
# version pinned in Vencord's package.json through npx.
setup_pnpm() {
    have pnpm && return
    pm=$(node -p 'require(process.argv[1]).packageManager.split("+")[0]' "$vencord/package.json")
    shim=$(mktemp -d)
    trap 'rm -rf "$shim"' EXIT
    printf '#!/bin/sh\nexec npx --yes %s "$@"\n' "$pm" >"$shim/pnpm"
    chmod +x "$shim/pnpm"
    PATH="$shim:$PATH"
    say "pnpm not found; running $pm through npx"
}

clone_or_pull() { # dir url [fallback url]
    if [ -L "$1" ]; then
        die "$1 is a symlink; Vencord's build cannot resolve imports through one. Replace it with a clone."
    elif [ -d "$1/.git" ]; then
        say "Updating $1"
        git -C "$1" pull --ff-only
    elif [ -e "$1" ]; then
        die "$1 exists but is not a git checkout"
    else
        say "Cloning $2 into $1"
        git clone "$2" "$1" || { [ -n "${3:-}" ] && git clone "$3" "$1"; }
    fi
}

inject() {
    say "Downloading Vencord's installer"
    node scripts/runInstaller.mjs -- --version
    case $OS in
        mac) bin="$vencord/dist/Installer/VencordInstallerCli-darwin" ;;
        linux) bin="$vencord/dist/Installer/VencordInstallerCli-linux" ;;
    esac
    [ -x "$bin" ] || die "Vencord's installer did not download"

    set -- --install
    [ -n "$discord" ] && set -- "$@" --location "$discord"

    # The same environment pnpm inject sets: patch Discord to load this checkout's dist folder.
    say "Patching Discord"
    if VENCORD_USER_DATA_DIR="$vencord" VENCORD_DEV_INSTALL=1 "$bin" "$@" </dev/tty; then
        return
    fi

    if [ "$OS" = linux ] && [ "$(id -u)" -ne 0 ] &&
        ask "Patching failed. Retry as root? Discord in /usr or /opt, or a system-wide Flatpak, needs it."; then
        for elevate in sudo doas run0 pkexec; do
            have "$elevate" || continue
            "$elevate" env "VENCORD_USER_DATA_DIR=$vencord" VENCORD_DEV_INSTALL=1 "SUDO_USER=$(id -un)" \
                "XDG_CONFIG_HOME=${XDG_CONFIG_HOME:-$HOME/.config}" "$bin" "$@" </dev/tty && return
            break
        done
    fi
    if [ "$OS" = mac ]; then
        echo "If the error says 'operation not permitted', allow your terminal app under System Settings >"
        echo "Privacy & Security > App Management, then run this again."
    fi
    die "patching Discord failed"
}

point_vesktop() {
    dist="$vencord/dist"
    case $OS in
        mac) set -- "$HOME/Library/Application Support/vesktop" ;;
        linux) set -- "${XDG_CONFIG_HOME:-$HOME/.config}/vesktop" "$HOME/.var/app/dev.vencord.Vesktop/config/vesktop" ;;
    esac
    found=0
    for dir in "$@"; do
        [ -d "$dir" ] || continue
        found=1
        if pgrep -i -x "vesktop(\.bin)?" >/dev/null 2>&1; then
            die "Vesktop is running; quit it first, or it overwrites the setting on exit"
        fi
        node -e '
            const fs = require("fs"), [file, dist] = process.argv.slice(1);
            let state = {};
            try { state = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
            state.vencordDir = dist;
            fs.writeFileSync(file, JSON.stringify(state, null, 4));
        ' "$dir/state.json" "$dist"
        say "Set Vesktop's Vencord location to $dist ($dir/state.json)"
        case $dir in
            "$HOME/.var/app/"*)
                # Without access to the folder, the Flatpak swaps the path for a temporary one.
                flatpak override --user dev.vencord.Vesktop --filesystem="$vencord"
                say "Gave the Vesktop Flatpak access to $vencord"
                ;;
        esac
    done
    [ "$found" = 1 ] || die "no Vesktop settings folder found; start Vesktop once, quit it, and run this again"
}

plugin() {
    vencord=$HOME/Vencord discord="" vesktop=0 do_inject=1
    while [ $# -gt 0 ]; do
        case $1 in
            --vencord-dir) [ $# -ge 2 ] || die "$1 needs a value"; vencord=$2; shift ;;
            --discord) [ $# -ge 2 ] || die "$1 needs a value"; discord=$2; shift ;;
            --vesktop) vesktop=1 ;;
            --no-inject) do_inject=0 ;;
            *) usage; exit 1 ;;
        esac
        shift
    done
    check_tools

    case $vencord in /*) ;; *) vencord="$PWD/$vencord" ;; esac
    clone_or_pull "$vencord" "$VENCORD_URL"
    [ "$(node -p 'require(process.argv[1]).name' "$vencord/package.json" 2>/dev/null)" = vencord ] ||
        die "$vencord is not a Vencord checkout"
    mkdir -p "$vencord/src/userplugins"
    clone_or_pull "$vencord/src/userplugins/impede" "$REPO_URL" "$MIRROR_URL"

    cd "$vencord"
    setup_pnpm
    say "Installing Vencord's dependencies"
    pnpm install --frozen-lockfile
    say "Building Vencord"
    pnpm build

    if [ "$vesktop" = 1 ]; then
        point_vesktop
        say "Done. Start Vesktop and enable Impede in Settings > Vencord > Plugins."
    elif [ "$do_inject" = 1 ]; then
        inject
        say "Done. Quit Discord fully (not just its window), start it again, and enable Impede"
        say "in Settings > Vencord > Plugins."
    else
        say "Built $vencord/dist. Run this again without --no-inject to patch Discord."
    fi
}

theme() {
    [ $# -eq 0 ] || { usage; exit 1; }
    src=$(mktemp)
    trap 'rm -f "$src"' EXIT
    here=$(dirname "$0")
    if [ -f "$here/impede.theme.css" ]; then
        cp "$here/impede.theme.css" "$src"
    else
        say "Downloading impede.theme.css"
        download "$THEME_URL" "$src"
    fi

    case $OS in
        mac) base="$HOME/Library/Application Support" flatpak="" ;;
        linux) base=${XDG_CONFIG_HOME:-$HOME/.config} flatpak="$HOME/.var/app" ;;
    esac
    count=0
    while IFS='|' read -r name dir; do
        [ -n "$dir" ] && [ -d "$dir" ] || continue
        mkdir -p "$dir/themes"
        cp "$src" "$dir/themes/impede.theme.css"
        say "$name: $dir/themes/impede.theme.css"
        count=$((count + 1))
    done <<EOF
Vencord|$base/Vencord
Vesktop|$base/vesktop
Equicord|$base/Equicord
Equibop|$base/equibop
BetterDiscord|$base/BetterDiscord
Vencord (Discord Flatpak)|${flatpak:+$flatpak/com.discordapp.Discord/config/Vencord}
Equicord (Discord Flatpak)|${flatpak:+$flatpak/com.discordapp.Discord/config/Equicord}
BetterDiscord (Discord Flatpak)|${flatpak:+$flatpak/com.discordapp.Discord/config/BetterDiscord}
Vesktop (Flatpak)|${flatpak:+$flatpak/dev.vencord.Vesktop/config/vesktop}
EOF
    [ "$count" -gt 0 ] || die "no Vencord, Vesktop, Equicord, Equibop or BetterDiscord settings folder found"
    say "Done. Switch impede on in Settings > Themes."
}

[ $# -gt 0 ] || { usage; exit 1; }
mode=$1
shift
case $mode in
    plugin) plugin "$@" ;;
    theme) theme "$@" ;;
    -h | --help | help) usage ;;
    *) usage; exit 1 ;;
esac
