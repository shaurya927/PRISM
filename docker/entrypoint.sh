#!/bin/sh
# PRISM container entrypoint: optional one-time weight download, then the given command.
set -e

mkdir -p "$PRISM_WEIGHTS_DIR" "$PRISM_RUNS_DIR"

# With PRISM_PREFETCH_WEIGHTS=1 the first start downloads every model, so the first case
# does not wait for downloads. A marker file in the weights volume skips it afterwards.
# Any model that failed to download is fetched again on first use.
if [ "${PRISM_PREFETCH_WEIGHTS:-0}" = "1" ] && [ ! -f "$PRISM_WEIGHTS_DIR/.prefetched" ]; then
  echo "[prism] downloading model weights into $PRISM_WEIGHTS_DIR (first start only)"
  python scripts/download_weights.py
  touch "$PRISM_WEIGHTS_DIR/.prefetched"
fi

exec "$@"
