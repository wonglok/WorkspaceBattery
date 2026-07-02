#!/bin/bash
# download-node.sh
# Downloads the official Node.js binary for the current macOS architecture
# and extracts just the `node` binary into web/bin/.
#
# Usage:  ./scripts/download-node.sh [version]
#         Defaults to 22.14.0

set -euo pipefail

VERSION="${1:-22.14.0}"
ARCH=$(uname -m)
case "$ARCH" in
  arm64)  ARCH_NAME="arm64" ;;
  x86_64) ARCH_NAME="x64"   ;;
  *)      echo "Unsupported architecture: $ARCH" && exit 1 ;;
esac

FILENAME="node-v${VERSION}-darwin-${ARCH_NAME}"
TARBALL="${FILENAME}.tar.gz"
URL="https://nodejs.org/dist/v${VERSION}/${TARBALL}"
OUTDIR="$(cd "$(dirname "$0")/.." && pwd)/web/bin"

echo "Downloading Node.js ${VERSION} for ${ARCH_NAME}..."
echo "  URL: $URL"
echo "  Output: $OUTDIR/node"

mkdir -p "$OUTDIR"
curl -#L "$URL" | tar -xz --strip-components=2 -C "$OUTDIR" "${FILENAME}/bin/node"

chmod +x "$OUTDIR/node"

echo ""
echo "Done! Bundled node binary:"
ls -lh "$OUTDIR/node"
file "$OUTDIR/node"
