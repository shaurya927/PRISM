# syntax=docker/dockerfile:1.7
#
# PRISM: API + project website + investigator app on one port (8000).
#
#   docker build -t prism .                                                        # CPU (default)
#   docker build -t prism:gpu --build-arg TORCH_INDEX=https://download.pytorch.org/whl/cu128 .
#
# Model weights are not baked in. They download on first use (or at first start with
# PRISM_PREFETCH_WEIGHTS=1) into /app/weights, which should be a volume.

# --------------------------------------------------------------------------- 1. frontend
FROM node:22-alpine AS frontend
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# --------------------------------------------------------------------------- 2. vendor repos
# Pinned to the commits PRISM was built and evaluated against. Only repos with a permissive
# licence are included: fast-alpr (MIT), parseq (Apache-2.0), vehicle-reidentification (MIT).
# lpsr-lacd has no licence file, so super-resolution is "not installed" in the image; the
# pipeline's results are identical without it (it is a visual aid only).
FROM alpine:3.20 AS vendor
RUN apk add --no-cache curl tar
ARG FAST_ALPR_SHA=c5a94706f175590b2bc09aa86f46182d4c267fae
ARG PARSEQ_SHA=1902db043c029a7e03a3818c616c06600af574be
ARG REID_SHA=2f8ab6b5632f4fd5edef0bcb0e4141ae2a2f77b9
WORKDIR /vendor
# Each repo is unpacked from its GitHub archive. A one-line .git/HEAD keeps the exact commit
# readable by prism/custody.py, so reports still record it. The re-ID demo videos (~190 MB)
# are not used at runtime and are dropped; its OSNet weights in models/ are kept.
RUN set -eux; \
    fetch() { \
      mkdir -p "$1/.git"; \
      curl -fsSL "https://github.com/$2/archive/$3.tar.gz" | tar -xz -C "$1" --strip-components=1; \
      echo "$3" > "$1/.git/HEAD"; \
    }; \
    fetch fast-alpr ankandrew/fast-alpr "$FAST_ALPR_SHA"; \
    fetch parseq baudm/parseq "$PARSEQ_SHA"; \
    fetch vehicle-reidentification kHarshit/vehicle-reidentification "$REID_SHA"; \
    rm -rf vehicle-reidentification/videos vehicle-reidentification/veh_reid_video.mov \
           vehicle-reidentification/veh_reid_demo.png

# --------------------------------------------------------------------------- 3. runtime
FROM python:3.11-slim-bookworm AS runtime

ARG TORCH_INDEX=https://download.pytorch.org/whl/cpu
ARG WITH_CHROMIUM=1
ARG PRISM_GIT_COMMIT=""

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PRISM_WEIGHTS_DIR=/app/weights \
    PRISM_RUNS_DIR=/app/runs \
    TORCH_HOME=/app/weights/torch \
    HF_HOME=/app/weights/hf \
    XDG_CACHE_HOME=/app/weights/cache \
    YOLO_CONFIG_DIR=/app/weights/ultralytics \
    PLAYWRIGHT_BROWSERS_PATH=/opt/playwright \
    PRISM_GIT_COMMIT=${PRISM_GIT_COMMIT}

# OpenCV (pulled in by ultralytics) needs libGL and GLib. Playwright's bundled Node binary
# needs libatomic, which python:slim does not ship (without it the driver exits with 127).
RUN apt-get update \
 && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 libatomic1 libstdc++6 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# PyTorch first, from the chosen index, so requirements.txt does not pull the default CUDA build.
COPY requirements.txt ./
RUN pip install torch torchvision --index-url "${TORCH_INDEX}" \
 && pip install -r requirements.txt

# Headless Chromium for PDF reports. Without it PRISM returns the HTML report instead.
RUN if [ "${WITH_CHROMIUM}" = "1" ]; then \
      python -m playwright --version \
      && python -m playwright install --with-deps chromium \
      && rm -rf /var/lib/apt/lists/*; \
    fi

RUN useradd --create-home --uid 10001 prism

COPY --chown=prism:prism --from=vendor /vendor ./vendor
COPY --chown=prism:prism prism ./prism
COPY --chown=prism:prism backend ./backend
COPY --chown=prism:prism scripts ./scripts
COPY --chown=prism:prism data ./data
COPY --chown=prism:prism reports ./reports
COPY --chown=prism:prism tests ./tests
COPY --chown=prism:prism pytest.ini ./
COPY --chown=prism:prism --from=frontend /src/frontend/dist ./frontend/dist
COPY docker/entrypoint.sh /usr/local/bin/prism-entrypoint

# Strip CRLF in case the script was checked out on Windows.
RUN sed -i 's/\r$//' /usr/local/bin/prism-entrypoint \
 && chmod 0755 /usr/local/bin/prism-entrypoint \
 && mkdir -p /app/weights /app/runs \
 && chown prism:prism /app /app/weights /app/runs

USER prism
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=90s --retries=3 \
  CMD python -c "import sys, urllib.request; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=8).status == 200 else 1)"

ENTRYPOINT ["prism-entrypoint"]
CMD ["python", "-m", "uvicorn", "backend.app.main:app", "--host", "0.0.0.0", "--port", "8000"]
