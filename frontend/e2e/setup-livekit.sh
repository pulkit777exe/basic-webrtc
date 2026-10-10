#!/usr/bin/env bash
# Installs the pinned livekit-server binary used by specs/sfu.spec.ts.
#
# The SFU spec boots a real LiveKit server the same way the TURN spec boots
# the in-repo TURN server: as a child process of the test, on fixed loopback
# ports. The binary is deliberately NOT committed (57MB) — CI runs this
# script, and without the binary the spec skips with an explanation instead
# of failing. Idempotent: exits early when the pinned binary already exists.
set -euo pipefail

VERSION="1.13.8"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/bin"
BIN="$DIR/livekit-server"

if [[ -x "$BIN" ]]; then
  echo "livekit-server already present at $BIN"
  exit 0
fi

OS="$(uname -s)"
ARCH="$(uname -m)"
case "$OS/$ARCH" in
  Linux/x86_64)  PLATFORM="linux_amd64" ;;
  Linux/aarch64|Linux/arm64) PLATFORM="linux_arm64" ;;
  Darwin/arm64)  PLATFORM="darwin_arm64" ;;
  Darwin/x86_64) PLATFORM="darwin_amd64" ;;
  *) echo "unsupported platform: $OS/$ARCH" >&2; exit 1 ;;
esac

TARBALL="livekit_${VERSION}_${PLATFORM}.tar.gz"
URL="https://github.com/livekit/livekit/releases/download/v${VERSION}/${TARBALL}"

mkdir -p "$DIR"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
curl -sSL -o "$tmp/$TARBALL" "$URL"
curl -sSL -o "$tmp/checksums.txt" "https://github.com/livekit/livekit/releases/download/v${VERSION}/checksums.txt"

# Verify before extracting: a corrupt media server binary is the worst kind of
# flake — everything downstream fails mysteriously.
(
  cd "$tmp"
  grep "  ${TARBALL}\$" checksums.txt > single.sha
  if command -v sha256sum >/dev/null; then
    sha256sum -c single.sha
  else
    shasum -a 256 -c single.sha
  fi
)
tar xzf "$tmp/$TARBALL" -C "$tmp"
mv "$tmp/livekit-server" "$BIN"
chmod +x "$BIN"
"$BIN" --version
echo "installed $BIN"
