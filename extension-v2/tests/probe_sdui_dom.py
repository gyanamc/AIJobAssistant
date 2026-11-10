"""Probe LinkedIn SDUI job card + detail DOM structure for selector updates."""

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
PORT = 9243

PROBE = r"""
async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const cards = Array.from(document.querySelectorAll('div[role="button"][componentkey]'))
    .filter(el => (el.innerText || '').trim().length > 40);
  const first = cards[0];
  if (!first) return { error: 'no cards' };

  const before = location.href;
  first.click();
  await sleep(2500);
  const after = location.href;
  const params = new URLSearchParams(location.search);

  // Collect candidate detail roots
  const candidates = [];
  const sels = [
    'main', '[role="main"]', 'article', '#job-details',
    '.jobs-description', '.jobs-details', '.job-view-layout',
    '[data-test-id]', 'section'
  ];
  for (const s of sels) {
    for (const el of Array.from(document.querySelectorAll(s)).slice(0, 8)) {
      const text = (el.innerText || '').trim();
      if (text.length < 80) continue;
      candidates.push({
        sel: s,
        tag: el.tagName,
        className: String(el.className || '').slice(0, 120),
        id: el.id || null,
        role: el.getAttribute('role'),
        textHead: text.slice(0, 180),
        textLen: text.length,
      });
    }
  }

  // Headings near detail
  const headings = Array.from(document.querySelectorAll('h1,h2,h3'))
    .slice(0, 20)
    .map(h => ({ tag: h.tagName, text: (h.innerText||'').trim().slice(0,120), className: String(h.className||'').slice(0,80) }));

  // Apply buttons
  const applyLike = Array.from(document.querySelectorAll('a,button'))
    .filter(el => /apply/i.test(el.innerText || '') || /apply/i.test(el.getAttribute('aria-label') || ''))
    .slice(0, 10)
    .map(el => ({
      tag: el.tagName,
      text: (el.innerText||'').trim().slice(0,80),
      aria: el.getAttribute('aria-label'),
      href: el.getAttribute('href'),
      className: String(el.className||'').slice(0,100),
    }));

  // Card anatomy
  const cardLines = (first.innerText || '').split('\n').map(s => s.trim()).filter(Boolean).slice(0, 12);
  const cardAttrs = {};
  for (const a of first.attributes) cardAttrs[a.name] = a.value.slice(0, 160);

  // Look for job id anywhere near card
  const htmlSnippet = first.outerHTML.slice(0, 1500);

  return {
    before, after,
    currentJobId: params.get('currentJobId'),
    cardCount: cards.length,
    cardLines,
    cardAttrs,
    htmlSnippet,
    headings,
    applyLike,
    candidates: candidates.slice(0, 15),
  };
}
"""


def fetch_json(path: str):
    with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/{path}", timeout=5) as r:
        return json.loads(r.read())


def wait_cdp():
    for _ in range(40):
        try:
            fetch_json("json/version")
            return True
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


async def cdp(ws_url: str):
    import websockets
    async with websockets.connect(ws_url, max_size=16_000_000) as ws:
        msg_id = 0

        async def send(method, params=None):
            nonlocal msg_id
            msg_id += 1
            await ws.send(json.dumps({"id": msg_id, "method": method, "params": params or {}}))
            while True:
                raw = json.loads(await ws.recv())
                if raw.get("id") == msg_id:
                    return raw
            return None

        await send("Network.enable")
        await send("Page.enable")
        await send("Runtime.enable")
        await send("Page.navigate", {"url": "https://www.linkedin.com/"})
        await asyncio.sleep(2)
        for c in load_cookies():
            await send("Network.setCookie", c)
        await send("Page.navigate", {
            "url": "https://www.linkedin.com/jobs/search-results/?keywords=AI%20Leader&location=India"
        })
        await asyncio.sleep(6)
        res = await send("Runtime.evaluate", {
            "expression": f"({PROBE})()",
            "awaitPromise": True,
            "returnByValue": True,
        })
        return res.get("result", {}).get("result", {}).get("value") or res


async def main():
    profile = Path(tempfile.mkdtemp(prefix="aja-sdui-")) / "p"
    profile.mkdir(parents=True)
    chrome = subprocess.Popen([
        str(CHROME_PATH),
        f"--remote-debugging-port={PORT}",
        f"--user-data-dir={profile}",
        "--no-first-run",
        "--no-default-browser-check",
        "--window-size=1400,900",
        "about:blank",
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        assert wait_cdp()
        page = next(t for t in fetch_json("json/list") if t.get("type") == "page")
        result = await cdp(page["webSocketDebuggerUrl"])
        print(json.dumps(result, indent=2))
    finally:
        chrome.terminate()
        try:
            chrome.wait(timeout=5)
        except Exception:
            chrome.kill()


if __name__ == "__main__":
    asyncio.run(main())
