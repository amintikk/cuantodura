"""Download helpers: HEAD probing and resumable streaming download with size check."""
from __future__ import annotations

import time
import urllib.error
import urllib.request
from pathlib import Path

from config import USER_AGENT


def _req(url: str, method: str = "GET") -> urllib.request.Request:
    return urllib.request.Request(url, method=method, headers={"User-Agent": USER_AGENT})


def exists(url: str) -> int | None:
    """Content length (-1 if unknown) if the file is published, else None."""
    try:
        with urllib.request.urlopen(_req(url, "HEAD"), timeout=60) as r:
            n = int(r.headers.get("Content-Length") or 0)
            ctype = r.headers.get("Content-Type", "")
            if "html" in ctype or (n and n < 1000):
                return None
            return n or -1  # some responses omit Content-Length
    except urllib.error.HTTPError:
        return None


def fetch(url: str, dest: Path, tries: int = 4) -> Path:
    tmp = dest.with_suffix(dest.suffix + ".part")
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(_req(url), timeout=120) as r, open(tmp, "wb") as f:
                expected = int(r.headers.get("Content-Length") or 0)
                while chunk := r.read(1 << 20):
                    f.write(chunk)
            if expected and tmp.stat().st_size != expected:
                raise OSError(f"tamaño incompleto {tmp.stat().st_size} != {expected}")
            tmp.rename(dest)
            return dest
        except Exception as e:  # noqa: BLE001 - retried and re-raised
            if attempt == tries - 1:
                raise
            print(f"  reintento {attempt + 1} {url}: {e}", flush=True)
            time.sleep(10 * (attempt + 1))
    raise AssertionError
