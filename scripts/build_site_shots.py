"""Real screenshots for the project website (investigator app + a PDF/HTML report page).

Needs the server running (python -m uvicorn backend.app.main:app --port 8000) and Playwright Chromium.
It uploads a demo clip through the normal API, waits for the result, and screenshots the investigator
app on that case. Output: frontend/public/media/app_*.jpg and report_page.jpg.

Usage:  python scripts/build_site_shots.py [--base http://127.0.0.1:8000] [--clip data/test_clips/night_partial_white.mp4]
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.request
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MEDIA = ROOT / "frontend" / "public" / "media"


def upload(base: str, clip: Path) -> str:
    boundary = uuid.uuid4().hex
    body = (
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{clip.name}\"\r\n"
        "Content-Type: video/mp4\r\n\r\n"
    ).encode() + clip.read_bytes() + f"\r\n--{boundary}--\r\n".encode()
    req = urllib.request.Request(f"{base}/api/jobs", data=body, method="POST",
                                 headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.load(r)["job_id"]


def wait(base: str, job_id: str, timeout_s: float = 600) -> None:
    t0 = time.time()
    while time.time() - t0 < timeout_s:
        with urllib.request.urlopen(f"{base}/api/jobs/{job_id}", timeout=30) as r:
            job = json.load(r)
        if job["status"] == "done":
            return
        if job["status"] == "error":
            raise SystemExit(f"job failed: {job.get('error')}")
        time.sleep(1.5)
    raise SystemExit("timed out waiting for the job")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8000")
    ap.add_argument("--clip", default=str(ROOT / "data" / "test_clips" / "night_partial_white.mp4"))
    args = ap.parse_args()
    from playwright.sync_api import sync_playwright

    MEDIA.mkdir(parents=True, exist_ok=True)
    job_id = upload(args.base, Path(args.clip))
    print("job", job_id)
    wait(args.base, job_id)
    report = sorted((ROOT / "reports" / "night_partial_white").glob("PRISM_report_*.html"))
    with sync_playwright() as p:
        b = p.chromium.launch()
        page = b.new_page(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
        page.goto(f"{args.base}/app?job={job_id}", wait_until="networkidle")
        page.wait_for_timeout(1200)
        for tab, name in [("Evidence", "app_evidence"), ("Shortlist", "app_shortlist"), ("Vehicles found", "app_vehicles")]:
            page.get_by_role("button", name=tab, exact=True).click()
            page.wait_for_timeout(1200)
            page.screenshot(path=str(MEDIA / f"{name}.jpg"), type="jpeg", quality=82)
            print("wrote", name)
        if report:
            page.set_viewport_size({"width": 900, "height": 1200})
            page.goto(report[-1].as_uri(), wait_until="networkidle")
            page.wait_for_timeout(600)
            page.screenshot(path=str(MEDIA / "report_page.jpg"), type="jpeg", quality=82)
            print("wrote report_page")
        b.close()
    # The demo job is only needed for the screenshots.
    urllib.request.urlopen(urllib.request.Request(f"{args.base}/api/jobs/{job_id}", method="DELETE"), timeout=30)


if __name__ == "__main__":
    sys.exit(main())
