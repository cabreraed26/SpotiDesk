#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# SpotiDesk — Generador de bundles para macOS (Instalador .dmg + Portable .app/.zip)
# Uso:
#   bash scripts/build-macos.sh                      # Arquitectura nativa (usa .env si existe)
#   bash scripts/build-macos.sh --public             # Build público sin Client ID embebido
#   bash scripts/build-macos.sh --universal --public # Universal público (Apple Silicon + Intel)
# ==============================================================================

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Error: Este script debe ejecutarse en macOS." >&2
  exit 1
fi

for cmd in pnpm cargo node ditto; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Error: No se encontró '$cmd' en el PATH." >&2
    exit 1
  fi
done

UNIVERSAL=false
PUBLIC_BUILD=false
for arg in "$@"; do
  case "$arg" in
    --universal)
      UNIVERSAL=true
      ;;
    --public)
      PUBLIC_BUILD=true
      ;;
    -h|--help)
      echo "Uso: bash scripts/build-macos.sh [--universal] [--public]"
      exit 0
      ;;
    *)
      echo "Opción desconocida: $arg" >&2
      exit 1
      ;;
  esac
done

BUILD_SUFFIX=""
if [[ "$PUBLIC_BUILD" == true ]]; then
  export SPOTIDESK_PUBLIC_BUILD=1
  export VITE_SPOTIFY_CLIENT_ID=""
  BUILD_SUFFIX="_public"
fi

PRODUCT_NAME="$(node -e 'const c = require("./src-tauri/tauri.conf.json"); console.log(c.productName || "SpotiDesk");')"
VERSION="$(node -e 'const c = require("./src-tauri/tauri.conf.json"); console.log(c.version || "0.0.0");')"

HOST_ARCH="$(uname -m)"
if [[ "$UNIVERSAL" == true ]]; then
  ARCH_LABEL="universal"
  TARGET_ARGS=(--target universal-apple-darwin)
  BUNDLE_DIR="$ROOT_DIR/src-tauri/target/universal-apple-darwin/release/bundle"

  if command -v rustup >/dev/null 2>&1; then
    INSTALLED="$(rustup target list --installed)"
    for t in aarch64-apple-darwin x86_64-apple-darwin; do
      if ! grep -qx "$t" <<<"$INSTALLED"; then
        echo "Instalando target de Rust faltante: $t..."
        rustup target add "$t"
      fi
    done
  fi
else
  if [[ "$HOST_ARCH" == "arm64" ]]; then
    ARCH_LABEL="aarch64"
  else
    ARCH_LABEL="$HOST_ARCH"
  fi
  TARGET_ARGS=()
  BUNDLE_DIR="$ROOT_DIR/src-tauri/target/release/bundle"
fi

OUT_DIR="$ROOT_DIR/releases/macos"
PORTABLE_DIR="$OUT_DIR/portable"

echo "============================================================"
if [[ "$PUBLIC_BUILD" == true ]]; then
  echo "  Compilando $PRODUCT_NAME v$VERSION para macOS ($ARCH_LABEL · PÚBLICO sin Client ID)"
else
  echo "  Compilando $PRODUCT_NAME v$VERSION para macOS ($ARCH_LABEL)"
fi
echo "============================================================"

if [[ ! -d "$ROOT_DIR/node_modules" ]]; then
  echo "Instalando dependencias JS con pnpm..."
  pnpm install --frozen-lockfile
fi

echo "Ejecutando compilación Tauri (app + dmg)..."
if [[ "${#TARGET_ARGS[@]}" -gt 0 ]]; then
  pnpm tauri build "${TARGET_ARGS[@]}" --bundles app,dmg
else
  pnpm tauri build --bundles app,dmg
fi

APP_SRC="$BUNDLE_DIR/macos/${PRODUCT_NAME}.app"
if [[ ! -d "$APP_SRC" ]]; then
  echo "Error: No se encontró el paquete .app esperado en: $APP_SRC" >&2
  exit 1
fi

rm -rf "$PORTABLE_DIR"
mkdir -p "$PORTABLE_DIR"

# 1. Portable (.app directo + .zip preservando firma y metadatos macOS)
echo "Empaquetando versión portable..."
ditto "$APP_SRC" "$PORTABLE_DIR/${PRODUCT_NAME}.app"

PORTABLE_ZIP="$OUT_DIR/${PRODUCT_NAME}_${VERSION}_macos_${ARCH_LABEL}${BUILD_SUFFIX}_portable.zip"
rm -f "$PORTABLE_ZIP"
ditto -c -k --sequesterRsrc --keepParent "$APP_SRC" "$PORTABLE_ZIP"

# 2. Instalador (.dmg)
echo "Copiando instalador .dmg..."
DMG_SRC="$(find "$BUNDLE_DIR/dmg" -maxdepth 1 -name '*.dmg' 2>/dev/null | head -n 1 || true)"
DMG_OUT="$OUT_DIR/${PRODUCT_NAME}_${VERSION}_macos_${ARCH_LABEL}${BUILD_SUFFIX}_installer.dmg"
rm -f "$DMG_OUT"

if [[ -n "$DMG_SRC" && -f "$DMG_SRC" ]]; then
  cp "$DMG_SRC" "$DMG_OUT"
else
  echo "Aviso: Tauri no generó .dmg; creando instalador .dmg con hdiutil..."
  DMG_STAGE="$(mktemp -d)"
  trap 'rm -rf "$DMG_STAGE"' EXIT
  ditto "$APP_SRC" "$DMG_STAGE/${PRODUCT_NAME}.app"
  ln -s /Applications "$DMG_STAGE/Applications"
  hdiutil create \
    -volname "$PRODUCT_NAME" \
    -srcfolder "$DMG_STAGE" \
    -ov -format UDZO \
    "$DMG_OUT" >/dev/null
fi

echo ""
echo "============================================================"
echo "  Build macOS completado en: $OUT_DIR"
echo "============================================================"
echo "  Instalador (.dmg): $DMG_OUT"
echo "  Portable   (.zip): $PORTABLE_ZIP"
echo "  Portable   (.app): $PORTABLE_DIR/${PRODUCT_NAME}.app"
echo ""
ls -lh "$DMG_OUT" "$PORTABLE_ZIP"
