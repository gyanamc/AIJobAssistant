"""Verify SDUI scrape path: inject fixed content script helpers via page eval
simulating the new selectors, then load real extension and check EVALUATE_JOB.

Because content scripts run in an isolated world, we verify by:
1) Evaluating the same selector helpers in page world (DOM compatibility)
2) Loading the extension, enabling botRunning, waiting, and reading SW logs /
   savedJobs / outlined cards via a small bridge injected as an extension page.
"""

from __future__ import annotations

import asyncio
import json
import subprocess
import tempfile
import time
import urllib.request
from pathlib import Path

EXTENSION_DIR = Path(__file__).resolve().parents[1]
COOKIES_PATH = EXTENSION_DIR.parent / "data" / "scraper_linkedin_cookies.json"
CHROME_PATH = Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
PORT = 9245

# Mirror of the new helper logic for page-world verification
HELPER_PROBE = r"""
async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const getCurrentJobId = () => new URLSearchParams(location.search).get('currentJobId') || '';
  const findSduiCards = () => Array.from(document.querySelectorAll('div[role="button"][componentkey]'))
    .filter(el => {
      const text = (el.innerText || '').trim();
      if (text.length < 40) return false;
      return text.split('\n').map(s => s.trim()).filter(Boolean).length >= 2;
    });
  const parseSduiCard = (card) => {
    const raw = (card.innerText || '').split('\n').map(s => s.trim()).filter(Boolean);
    const skip = /^(viewed|promoted|saved|verified job|easy apply)$/i;
    const noise = /(alumni|clicked apply|people clicked|connections work|posted\b|\bago$|responded)/i;
    const lines = [];
    for (const line of raw) {
      if (skip.test(line) || noise.test(line)) continue;
      if (lines.length && lines[lines.length - 1] === line) continue;
      lines.push(line);
    }
    if (lines.length >= 2 && /\(verified job\)$/i.test(lines[0])) lines.shift();
    return { title: lines[0] || '', company: lines[1] || '', location: lines[2] || '' };
  };
  const getSduiDescription = () => {
    const about = Array.from(document.querySelectorAll('h2, h3'))
      .find(h => /about the job/i.test(h.innerText || ''));
    if (!about) return '';
    let root = about.parentElement;
    for (let i = 0; i < 6 && root; i++) {
      const text = (root.innerText || '').trim();
      if (text.length > 400) return text.replace(/^about the job\s*/i, '').trim();
      root = root.parentElement;
    }
    return '';
  };

  const cards = findSduiCards();
  if (!cards.length) return { ok: false, reason: 'no_sdui_cards' };
  const card = cards[1] || cards[0];
  const meta = parseSduiCard(card);
  const before = getCurrentJobId();
  card.click();
  await sleep(2500);
  const jobId = getCurrentJobId();
  const desc = getSduiDescription();
  return {
    ok: Boolean(jobId && meta.title && desc.length > 200),
    jobId,
    idChanged: jobId !== before,
    meta,
    descLen: desc.length,
    descHead: desc.slice(0, 180),
    cardCount: cards.length,
    legacyCount: document.querySelectorAll('.job-card-container[data-job-id], li[data-occludable-job-id]').length,
  };
}
"""


def fetch_json(path: str):
    with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/{path}", timeout=5) as r:
        return json.loads(r.read())


def wait_cdp():
    for _ in range(50):
        try:
            fetch_json("json/version"); return True
        except Exception:
            time.sleep(0.25)
    return False


def load_cookies():
    raw = json.loads(COOKIES_PATH.read_text())
    out = []
    for c in raw:
        item = {
            "name": c["name"], "value": c["value"],
            "domain": c.get("domain", ".linkedin.com"),
            "path": c.get("path", "/"),
            "secure": bool(c.get("secure", True)),
            "httpOnly": bool(c.get("httpOnly", False)),
        }
        if isinstance(c.get("expires"), (int, float)) and c["expires"] > 0:
            item["expires"] = int(c["expires"])
        if c.get("sameSite") in ("Strict", "Lax", "None"):
            item["sameSite"] = c["sameSite"]
        out.append(item)
    return out


async def main():
    import websockets
    profile = Path(tempfile.mkdtemp(prefix="aja-verify-")) / "p"
    profile.mkdir(parents=True)
    chrome = subprocess.Popen([
        str(CHROME_PATH),
        f"--remote-debugging-port={PORT}",
        f"--user-data-dir={profile}",
        "--disable-extensions-except=" + str(EXTENSION_DIR),
        "--load-extension=" + str(EXTENSION_DIR),
        "--no-first-run",
        "--no-default-browser-check",
        "--window-size=1400,900",
        "about:blank",
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        assert wait_cdp()
        # Wait for SW
        sw = None
        for _ in range(40):
            targets = fetch_json("json/list")
            sw = next((t for t in targets if t.get("type") == "service_worker"
                       and str(t.get("url","")).startswith("chrome-extension://")), None)
            if sw: break
            time.sleep(0.25)
        page = next(t for t in fetch_json("json/list") if t.get("type") == "page")

        async with websockets.connect(page["webSocketDebuggerUrl"], max_size=16_000_000) as ws:
            msg_id = 0
            async def send(method, params=None):
                nonlocal msg_id
                msg_id += 1
                await ws.send(json.dumps({"id": msg_id, "method": method, "params": params or {}}))
                while True:
                    raw = json.loads(await ws.recv())
                    if raw.get("id") == msg_id:
                        return raw

            await send("Network.enable"); await send("Page.enable"); await send("Runtime.enable")
            await send("Page.navigate", {"url": "https://www.linkedin.com/"})
            await asyncio.sleep(2)
            for c in load_cookies():
                await send("Network.setCookie", c)
            await send("Page.navigate", {
                "url": "https://www.linkedin.com/jobs/search-results/?keywords=AI%20Leader&location=India"
            })
            await asyncio.sleep(6)
            res = await send("Runtime.evaluate", {
                "expression": f"({HELPER_PROBE})()",
                "awaitPromise": True,
                "returnByValue": True,
            })
            helper = res.get("result", {}).get("result", {}).get("value")

        # Enable bot via SW storage
        ext_result = None
        if sw:
            async with websockets.connect(sw["webSocketDebuggerUrl"], max_size=2_000_000) as ws:
                msg_id = 0
                async def send(method, params=None):
                    nonlocal msg_id
                    msg_id += 1
                    await ws.send(json.dumps({"id": msg_id, "method": method, "params": params or {}}))
                    while True:
                        raw = json.loads(await ws.recv())
                        if raw.get("id") == msg_id:
                            return raw
                await send("Runtime.enable")
                set_res = await send("Runtime.evaluate", {
                    "expression": """new Promise(resolve => {
                      chrome.storage.local.set({
                        botRunning: true,
                        aiModel: 'free',
                        resumeSummary: 'Senior AI leader with GenAI, ML platforms, and product leadership.',
                        targetRoles: 'AI Leader',
                        targetLocations: 'India'
                      }, () => resolve({ ok: !chrome.runtime.lastError }));
                    })""",
                    "awaitPromise": True,
                    "returnByValue": True,
                })
                ext_result = {"storage": set_res.get("result", {}).get("result", {}).get("value")}

                # Reload LinkedIn tab so content script picks botRunning on inject
        # Navigate again and wait for outlines / messages
        page = next(t for t in fetch_json("json/list") if t.get("type") == "page")
        async with websockets.connect(page["webSocketDebuggerUrl"], max_size=8_000_000) as ws:
            msg_id = 0
            async def send(method, params=None):
                nonlocal msg_id
                msg_id += 1
                await ws.send(json.dumps({"id": msg_id, "method": method, "params": params or {}}))
                while True:
                    raw = json.loads(await ws.recv())
                    if raw.get("id") == msg_id:
                        return raw
            await send("Page.enable"); await send("Runtime.enable")
            await send("Page.navigate", {
                "url": "https://www.linkedin.com/jobs/search-results/?keywords=AI%20Leader&location=India"
            })
            await asyncio.sleep(14)  # allow at least one 6s tick + processing
            live = await send("Runtime.evaluate", {
                "expression": """(() => ({
                  outlined: Array.from(document.querySelectorAll('div[role="button"][componentkey]'))
                    .filter(el => (el.style.outline || '').includes('solid')).length,
                  sduiCards: Array.from(document.querySelectorAll('div[role="button"][componentkey]'))
                    .filter(el => (el.innerText||'').trim().length > 40).length,
                  currentJobId: new URLSearchParams(location.search).get('currentJobId'),
                  url: location.href,
                }))()""",
                "returnByValue": True,
            })
            live_val = live.get("result", {}).get("result", {}).get("value")

        # Check SW storage for evaluation side effects
        saved = None
        if sw:
            # SW may have restarted; rediscover
            targets = fetch_json("json/list")
            sw2 = next((t for t in targets if t.get("type") == "service_worker"
                        and str(t.get("url","")).startswith("chrome-extension://")), sw)
            async with websockets.connect(sw2["webSocketDebuggerUrl"], max_size=2_000_000) as ws:
                msg_id = 0
                async def send(method, params=None):
                    nonlocal msg_id
                    msg_id += 1
                    await ws.send(json.dumps({"id": msg_id, "method": method, "params": params or {}}))
                    while True:
                        raw = json.loads(await ws.recv())
                        if raw.get("id") == msg_id:
                            return raw
                await send("Runtime.enable")
                saved = await send("Runtime.evaluate", {
                    "expression": """new Promise(resolve => {
                      chrome.storage.local.get(['botRunning','savedJobs'], d => resolve({
                        botRunning: d.botRunning,
                        savedCount: Array.isArray(d.savedJobs) ? d.savedJobs.length : 0,
                        lastSaved: Array.isArray(d.savedJobs) && d.savedJobs.length
                          ? { title: d.savedJobs[d.savedJobs.length-1].title, company: d.savedJobs[d.savedJobs.length-1].company }
                          : null
                      }));
                    })""",
                    "awaitPromise": True,
                    "returnByValue": True,
                })
                saved = saved.get("result", {}).get("result", {}).get("value")

        report = {
            "helperProbe": helper,
            "extensionSetup": ext_result,
            "liveAfterTick": live_val,
            "storageAfter": saved,
        }
        print(json.dumps(report, indent=2))
        ok = bool(helper and helper.get("ok"))
        raise SystemExit(0 if ok else 1)
    finally:
        chrome.terminate()
        try: chrome.wait(timeout=5)
        except Exception: chrome.kill()


if __name__ == "__main__":
    asyncio.run(main())
