#!/bin/sh
set -eu

if [ "$(uname -s):$(uname -m)" != 'Darwin:arm64' ]; then
  printf '%s\n' 'This release supports macOS on Apple Silicon (arm64).' >&2
  exit 1
fi

repository_url='https://github.com/Neat-Snap/change-stack'
printf '[1/6] Finding the latest release...\n'
release_url=$(curl -fsSL -o /dev/null -w '%{url_effective}' "$repository_url/releases/latest")
case "$release_url" in
  "$repository_url"/releases/tag/v*) version=${release_url##*/} ;;
  *) printf '%s\n' 'Could not resolve the latest release.' >&2; exit 1 ;;
esac
case "$version" in
  *[!A-Za-z0-9.-]*) printf '%s\n' 'Unexpected release version.' >&2; exit 1 ;;
esac

download_dir=$(mktemp -d)
trap 'rm -rf "$download_dir"' 0
cd "$download_dir"
archive="cstack-${version}-macos-arm64.tar.gz"
printf '[2/6] Downloading %s...\n' "$version"
if [ -t 2 ]; then
  curl -fL --progress-bar -O "$repository_url/releases/download/$version/$archive"
else
  curl -fsSLO "$repository_url/releases/download/$version/$archive"
fi
printf '[3/6] Verifying the download...\n'
curl -fsSLO "$repository_url/releases/download/$version/SHA256SUMS"
shasum -a 256 -c SHA256SUMS
printf '[4/6] Extracting the release...\n'
tar -xzf "$archive"

install_dir="$HOME/.local/bin"
printf '[5/6] Installing cstack...\n'
mkdir -p "$install_dir"
install -m 755 "cstack-${version}-macos-arm64/cstack" "$install_dir/cstack"

printf '[6/6] Checking shell PATH...\n'
case ":$PATH:" in
  *":$install_dir:"*) ;;
  *)
    case "${SHELL:-/bin/zsh}" in
      */zsh) profile="${ZDOTDIR:-$HOME}/.zshrc" ;;
      */bash)
        if [ -f "$HOME/.bash_profile" ]; then profile="$HOME/.bash_profile"
        elif [ -f "$HOME/.bash_login" ]; then profile="$HOME/.bash_login"
        elif [ -f "$HOME/.profile" ]; then profile="$HOME/.profile"
        else profile="$HOME/.bash_profile"
        fi ;;
      *) profile="$HOME/.profile" ;;
    esac
    path_line='export PATH="$HOME/.local/bin:$PATH"'
    if [ ! -f "$profile" ] || ! grep -Fqx "$path_line" "$profile"; then
      mkdir -p "$(dirname "$profile")"
      printf '\n%s\n' "$path_line" >> "$profile"
    fi
    ;;
esac

printf 'Installed %s to %s\n' "$version" "$install_dir/cstack"
