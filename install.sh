#!/bin/sh

set -eu

REPO="latent-spaces/sottochat"
BASE_URL="https://github.com/$REPO/releases/latest/download"

say() {
  printf '%s\n' "$*"
}

fail() {
  say "sottochat installer: $*" >&2
  exit 1
}

command -v curl >/dev/null 2>&1 || fail "curl is required"
command -v tar >/dev/null 2>&1 || fail "tar is required"

case "$(uname -s)" in
  Darwin) os="darwin" ;;
  Linux) os="linux" ;;
  *) fail "unsupported operating system: $(uname -s)" ;;
esac

case "$(uname -m)" in
  arm64|aarch64) arch="arm64" ;;
  x86_64|amd64) arch="x64" ;;
  *) fail "unsupported architecture: $(uname -m)" ;;
esac

archive="sottochat-$os-$arch.tar.gz"
tmp_dir="$(mktemp -d 2>/dev/null || mktemp -d -t sottochat)"
trap 'rm -rf "$tmp_dir"' EXIT INT TERM

say "Downloading $archive..."
curl -fsSL "$BASE_URL/$archive" -o "$tmp_dir/$archive" ||
  fail "could not download $archive from the latest GitHub release"
curl -fsSL "$BASE_URL/checksums.txt" -o "$tmp_dir/checksums.txt" ||
  fail "could not download release checksums"

expected="$(awk -v name="$archive" '$2 == name { print $1 }' "$tmp_dir/checksums.txt")"
[ -n "$expected" ] || fail "release checksum for $archive is missing"

if command -v sha256sum >/dev/null 2>&1; then
  actual="$(sha256sum "$tmp_dir/$archive" | awk '{ print $1 }')"
elif command -v shasum >/dev/null 2>&1; then
  actual="$(shasum -a 256 "$tmp_dir/$archive" | awk '{ print $1 }')"
else
  fail "sha256sum or shasum is required to verify the download"
fi

[ "$actual" = "$expected" ] || fail "checksum verification failed"

tar -xzf "$tmp_dir/$archive" -C "$tmp_dir"
[ -f "$tmp_dir/sottochat" ] || fail "release archive does not contain sottochat"

install_dir="${SOTTOCHAT_INSTALL_DIR:-/usr/local/bin}"
if [ -d "$install_dir" ] && [ -w "$install_dir" ]; then
  install -m 0755 "$tmp_dir/sottochat" "$install_dir/sottochat"
elif [ ! -e "$install_dir" ] && mkdir -p "$install_dir" 2>/dev/null; then
  install -m 0755 "$tmp_dir/sottochat" "$install_dir/sottochat"
elif command -v sudo >/dev/null 2>&1; then
  say "Installing to $install_dir (sudo may ask for your password)..."
  sudo mkdir -p "$install_dir"
  sudo install -m 0755 "$tmp_dir/sottochat" "$install_dir/sottochat"
else
  fallback="$HOME/.local/bin"
  mkdir -p "$fallback"
  install -m 0755 "$tmp_dir/sottochat" "$fallback/sottochat"
  install_dir="$fallback"
fi

say "Installed sottochat to $install_dir/sottochat"
case ":$PATH:" in
  *":$install_dir:"*) say "Run: sottochat" ;;
  *)
    say "Add $install_dir to PATH, then run: sottochat"
    say "  export PATH=\"$install_dir:\$PATH\""
    ;;
esac
