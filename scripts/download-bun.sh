#!/bin/bash
# download-bun.sh
# Downloads the official Bun binary for the current macOS architecture
# and places it into web/bin/.
#
# Usage:  ./scripts/download-bun.sh [version]
#         Defaults to 1.3.14

set -euo pipefail

VERSION="${1:-1.3.14}"
ARCH=$(uname -m)
case "$ARCH" in
  arm64)  ARCH_NAME="aarch64" ;;
  x86_64) ARCH_NAME="x86_64" ;;
  *)      echo "Unsupported architecture: $ARCH" && exit 1 ;;
esac

OUTDIR="$(cd "$(dirname "$0")/.." && pwd)/web/bin"
BUN_TAG="bun-v${VERSION}"
URL="https://github.com/oven-sh/bun/releases/download/${BUN_TAG}/bun-darwin-${ARCH_NAME}.zip"

echo "Downloading Bun ${VERSION} for ${ARCH_NAME}..."
echo "  URL: $URL"
echo "  Output: $OUTDIR/bun"

mkdir -p "$OUTDIR"
curl -#L "$URL" -o /tmp/bun-download.zip
unzip -o /tmp/bun-download.zip -d /tmp/bun-extract "*/bun"
cp /tmp/bun-extract/*/bun "$OUTDIR/bun"
rm -rf /tmp/bun-download.zip /tmp/bun-extract

chmod +x "$OUTDIR/bun"

echo ""
echo "Done! Bundled bun binary:"
ls -lh "$OUTDIR/bun"
file "$OUTDIR/bun"
