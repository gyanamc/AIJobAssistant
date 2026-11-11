"""
Diagnose why LinkedIn scraping/scoring is not firing.

Launches real Chrome with the unpacked extension, injects LinkedIn cookies,
opens jobs pages (legacy /jobs/search/ and new /jobs/search-results/), and
reports DOM selector hits + content-script state.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

EXTENSION_DIR = Path(__file__).resolve().parents[1]
COOKIES_PATH = EXTENSION_DIR.parent / "data" / "scraper_linkedin_cookies.json"
CHROME_PATH = Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
PORT = 9242
OUT_DIR = Path(tempfile.mkdtemp(prefix="aja-diagnose-"))


def log(msg: str) -> None:
    print(msg, flush=True)


def fetch_json(path: str):
    with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/{path}", timeout=5) as r:
        return json.loads(r.read())


def wait_cdp(retries: int = 40) -> bool:
    for _ in range(retries):
        try:
            fetch_json("json/version")
            return True
        except Exception:
            time.sleep(0.25)
    return False


def load_cookies():
    raw = json.loads(COOKIES_PATH.read_text())
    cookies = []
    for c in raw:
        cookie = {
            "name": c["name"],
            "value": c["value"],
            "domain": c.get("domain", ".linkedin.com"),
            "path": c.get("path", "/"),
            "secure": bool(c.get("secure", True)),
            "httpOnly": bool(c.get("httpOnly", False)),
        }
        expires = c.get("expires")
        if isinstance(expires, (int, float)) and expires > 0:
            cookie["expires"] = int(expires)
        same = c.get("sameSite")
        if same in ("Strict", "Lax", "None"):
            cookie["sameSite"] = same
        cookies.append(cookie)
    return cookies


PROBE_JS = r"""
(() => {
  const q = (sel) => Array.from(document.querySelectorAll(sel));
  const legacy = q('.job-card-container[data-job-id], li[data-occludable-job-id]');
  const anyJobId = q('[data-job-id], [data-occludable-job-id]');
  const sduiButtons = q('div[role="button"][componentkey]');
  const sduiWithText = sduiButtons.filter(el => (el.innerText || '').trim().length > 40);
  const detailTitle = document.querySelector(
    '.job-details-jobs-unified-top-card__job-title, h1.t-24, .jobs-unified-top-card__job-title, h1'
  );
  const detailDesc = document.querySelector(
    '#job-details, .jobs-description__content, .jobs-description, article.jobs-description, article'
  );
  const listScroll = document.querySelector(
    '.jobs-search-results-list, .scaffold-layout__list, [role="list"]'
  );
  return {
    url: location.href,
    title: document.title,
    readyState: document.readyState,
    bodyTextSample: (document.body?.innerText || '').slice(0, 240),
    loggedInHint: !/sign in|join now|authwall/i.test(document.title + ' ' + (document.body?.innerText || '').slice(0, 500)),
    counts: {
      legacyCards: legacy.length,
      anyJobIdAttrs: anyJobId.length,
      sduiButtons: sduiButtons.length,
      sduiButtonsWithText: sduiWithText.length,
      detailTitle: !!detailTitle,
      detailDesc: !!detailDesc,
      listScroll: !!listScroll,
    },
    sampleLegacy: legacy.slice(0, 3).map(el => ({
      tag: el.tagName,
      jobId: el.getAttribute('data-job-id') || el.getAttribute('data-occludable-job-id'),
      text: (el.innerText || '').slice(0, 80),
    })),
    sampleSdui: sduiWithText.slice(0, 3).map(el => ({
      tag: el.tagName,
      componentkey: el.getAttribute('componentkey'),
      aria: el.getAttribute('aria-label'),
      text: (el.innerText || '').slice(0, 100),
    })),
    ajaRunning: !!document.__ajaRunning,
    currentJobId: new URLSearchParams(location.search).get('currentJobId'),
  };
})()
"""


async def cdp_eval(ws_url: str, expression: str):
    import websockets

    async with websockets.connect(ws_url, max_size=8_000_000) as ws:
        msg_id = 0

        async def send(method, params=None):
            nonlocal msg_id
            msg_id += 1
            payload = {"id": msg_id, "method": method}
            if params is not None:
                payload["params"] = params
            await ws.send(json.dumps(payload))
            while True:
                raw = json.loads(await ws.recv())
                if raw.get("id") == msg_id:
                    return raw

        await send("Runtime.enable")
        await send("Page.enable")
        result = await send("Runtime.evaluate", {
            "expression": expression,
            "returnByValue": True,
            "awaitPromise": True,
        })
        return result.get("result", {}).get("result", {})


async def diagnose_url(page_ws: str, url: str) -> dict:
    import websockets

    async with websockets.connect(page_ws, max_size=8_000_000) as ws:
        msg_id = 0

        async def send(method, params=None):
            nonlocal msg_id
            msg_id += 1
            payload = {"id": msg_id, "method": method}
            if params is not None:
                payload["params"] = params
            await ws.send(json.dumps(payload))
            while True:
                raw = json.loads(await ws.recv())
                if raw.get("id") == msg_id:
                    return raw

        await send("Page.enable")
        await send("Runtime.enable")
        nav = await send("Page.navigate", {"url": url})
        if "error" in nav:
            return {"error": nav["error"]}
        # wait for load
        deadline = time.time() + 25
        while time.time() < deadline:
            ready = await send("Runtime.evaluate", {
                "expression": "document.readyState",
                "returnByValue": True,
            })
            if ready.get("result", {}).get("result", {}).get("value") == "complete":
                break
            time.sleep(0.4)
        time.sleep(4)  # LinkedIn SPA settle
        probed = await send("Runtime.evaluate", {
            "expression": PROBE_JS,
            "returnByValue": True,
            "awaitPromise": True,
        })
        return probed.get("result", {}).get("result", {}).get("value") or {
            "raw": probed
        }


async def set_extension_storage(sw_ws: str):
    import websockets

    async with websockets.connect(sw_ws, max_size=2_000_000) as ws:
        msg_id = 0

        async def send(method, params=None):
            nonlocal msg_id
            msg_id += 1
            payload = {"id": msg_id, "method": method}
            if params is not None:
                payload["params"] = params
            await ws.send(json.dumps(payload))
            while True:
                raw = json.loads(await ws.recv())
                if raw.get("id") == msg_id:
                    return raw

        await send("Runtime.enable")
        expr = """
        new Promise((resolve) => {
          chrome.storage.local.set({
            botRunning: true,
            aiModel: 'free',
            resumeSummary: 'Senior AI leader with ML, GenAI, product and team leadership experience.',
            targetRoles: 'AI Leader',
            targetLocations: 'India'
          }, () => resolve({ ok: !chrome.runtime.lastError, id: chrome.runtime.id }));
        })
        """
        res = await send("Runtime.evaluate", {
            "expression": expr,
            "awaitPromise": True,
            "returnByValue": True,
        })
        return res.get("result", {}).get("result", {}).get("value")


async def inject_cookies(page_ws: str, cookies: list):
    import websockets

    async with websockets.connect(page_ws, max_size=4_000_000) as ws:
        msg_id = 0

        async def send(method, params=None):
            nonlocal msg_id
            msg_id += 1
            payload = {"id": msg_id, "method": method}
            if params is not None:
                payload["params"] = params
            await ws.send(json.dumps(payload))
            while True:
                raw = json.loads(await ws.recv())
                if raw.get("id") == msg_id:
                    return raw

        await send("Network.enable")
        # Must be on LinkedIn origin first for some cookies; navigate then set.
        await send("Page.enable")
        await send("Page.navigate", {"url": "https://www.linkedin.com/"})
        time.sleep(2)
        for c in cookies:
            params = {
                "name": c["name"],
                "value": c["value"],
                "domain": c["domain"],
                "path": c.get("path", "/"),
                "secure": c.get("secure", True),
                "httpOnly": c.get("httpOnly", False),
            }
            if "expires" in c:
                params["expires"] = c["expires"]
            if "sameSite" in c:
                params["sameSite"] = c["sameSite"]
            await send("Network.setCookie", params)


async def main():
    if not CHROME_PATH.exists():
        log("SKIP: Google Chrome not found")
        return 0
    if not COOKIES_PATH.exists():
        log(f"FAIL: cookies missing at {COOKIES_PATH}")
        return 1

    profile = OUT_DIR / "profile"
    profile.mkdir()
    cookies = load_cookies()

    chrome = subprocess.Popen([
        str(CHROME_PATH),
        f"--remote-debugging-port={PORT}",
        f"--user-data-dir={profile}",
        "--disable-extensions-except=" + str(EXTENSION_DIR),
        "--load-extension=" + str(EXTENSION_DIR),
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-popup-blocking",
        "--window-size=1400,900",
        "about:blank",
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    try:
        if not wait_cdp():
            log("FAIL: CDP not ready")
            return 1

        # Find page + service worker
        targets = fetch_json("json/list")
        page = next((t for t in targets if t.get("type") == "page"), None)
        # Extension SW may take a moment
        sw = None
        for _ in range(30):
            targets = fetch_json("json/list")
            sw = next((t for t in targets if t.get("type") == "service_worker"
                       and str(t.get("url", "")).startswith("chrome-extension://")), None)
            page = next((t for t in targets if t.get("type") == "page"), page)
            if sw and page:
                break
            time.sleep(0.3)

        report = {
            "extensionDir": str(EXTENSION_DIR),
            "serviceWorker": bool(sw),
            "extensionId": (sw or {}).get("url", "").split("/")[2] if sw else None,
            "pages": {},
        }
        log(f"serviceWorker={bool(sw)} extensionId={report['extensionId']}")

        if sw:
            storage = await set_extension_storage(sw["webSocketDebuggerUrl"])
            report["storageSet"] = storage
            log(f"storageSet={storage}")

        if not page:
            log("FAIL: no page target")
            print(json.dumps(report, indent=2))
            return 1

        await inject_cookies(page["webSocketDebuggerUrl"], cookies)
        # Refresh page target after navigation
        time.sleep(1)
        targets = fetch_json("json/list")
        page = next((t for t in targets if t.get("type") == "page"), page)

        urls = [
            ("legacy_search", "https://www.linkedin.com/jobs/search/?keywords=AI%20Leader&location=India"),
            ("search_results", "https://www.linkedin.com/jobs/search-results/?keywords=AI%20Leader&location=India"),
        ]
        for key, url in urls:
            log(f"probing {key}: {url}")
            # re-resolve page ws each time
            targets = fetch_json("json/list")
            page = next((t for t in targets if t.get("type") == "page"), page)
            result = await diagnose_url(page["webSocketDebuggerUrl"], url)
            report["pages"][key] = result
            counts = (result or {}).get("counts", {})
            log(f"  url={(result or {}).get('url')}")
            log(f"  loggedInHint={(result or {}).get('loggedInHint')} ajaRunning={(result or {}).get('ajaRunning')}")
            log(f"  counts={counts}")

            # If content script present and bot running, wait one tick and re-probe outlines
            if (result or {}).get("ajaRunning"):
                time.sleep(7)
                targets = fetch_json("json/list")
                page = next((t for t in targets if t.get("type") == "page"), page)
                after = await cdp_eval(
                    page["webSocketDebuggerUrl"],
                    """(() => ({
                      outlined: document.querySelectorAll('[style*="outline"]').length,
                      legacy: document.querySelectorAll('.job-card-container[data-job-id], li[data-occludable-job-id]').length,
                      sdui: document.querySelectorAll('div[role="button"][componentkey]').length,
                      currentJobId: new URLSearchParams(location.search).get('currentJobId'),
                    }))()""",
                )
                report["pages"][key + "_after_tick"] = after.get("value")
                log(f"  after_tick={after.get('value')}")

        out = OUT_DIR / "report.json"
        out.write_text(json.dumps(report, indent=2))
        log(f"REPORT {out}")
        print(json.dumps(report, indent=2))

        # Decision summary
        legacy = report["pages"].get("legacy_search", {}).get("counts", {})
        sdui = report["pages"].get("search_results", {}).get("counts", {})
        if (legacy.get("legacyCards") or 0) == 0 and (sdui.get("sduiButtonsWithText") or 0) > 0:
            log("ROOT_CAUSE: new /jobs/search-results/ UI has cards, but content script only looks for legacy selectors")
        elif (legacy.get("legacyCards") or 0) == 0 and (sdui.get("legacyCards") or 0) == 0:
            log("ROOT_CAUSE_CANDIDATE: no job cards found on either UI (login/authwall or empty results)")
        return 0
    finally:
        chrome.terminate()
        try:
            chrome.wait(timeout=5)
        except Exception:
            chrome.kill()
        # keep report dir; do not delete so caller can inspect


if __name__ == "__main__":
    import asyncio
    try:
        raise SystemExit(asyncio.run(main()))
    except KeyboardInterrupt:
        raise SystemExit(130)
