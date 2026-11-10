"""Deep-probe SDUI detail panel text extraction after clicking a non-selected card."""

from __future__ import annotations

import asyncio
import json
import subprocess
import tempfile
import time
import urllib.request
from pathlib import Path

COOKIES_PATH = Path(__file__).resolve().parents[2] / "data" / "scraper_linkedin_cookies.json"
CHROME_PATH = Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
PORT = 9244

PROBE = r"""
async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const cards = Array.from(document.querySelectorAll('div[role="button"][componentkey]'))
    .filter(el => (el.innerText || '').trim().length > 40);

  // Click 2nd card to force currentJobId change
  const target = cards[1] || cards[0];
  const beforeId = new URLSearchParams(location.search).get('currentJobId');
  const beforeLines = (target.innerText || '').split('\n').map(s => s.trim()).filter(Boolean);
  target.click();
  await sleep(3000);
  const afterId = new URLSearchParams(location.search).get('currentJobId');

  const about = Array.from(document.querySelectorAll('h2,h3'))
    .find(h => /about the job/i.test(h.innerText || ''));
  let aboutSection = null;
  if (about) {
    let root = about.parentElement;
    for (let i = 0; i < 5 && root; i++) {
      const t = (root.innerText || '').trim();
      if (t.length > 400) { aboutSection = { depth: i, textLen: t.length, textHead: t.slice(0, 500), className: String(root.className||'').slice(0,100) }; break; }
      root = root.parentElement;
    }
  }

  // Largest text block in main that looks like JD
  const main = document.querySelector('main') || document.body;
  const blocks = Array.from(main.querySelectorAll('div,section,article'))
    .map(el => ({ el, len: (el.innerText||'').trim().length, text: (el.innerText||'').trim() }))
    .filter(b => b.len > 600 && b.len < 12000)
    .sort((a,b) => b.len - a.len)
    .slice(0, 8)
    .map(b => ({
      len: b.len,
      className: String(b.el.className||'').slice(0,120),
      hasAbout: /about the job/i.test(b.text),
      head: b.text.slice(0, 250),
    }));

  // Selected card marker
  const selected = cards.find(c => /selected/i.test(c.innerText) || c.getAttribute('aria-current') || c.getAttribute('aria-pressed'));
  const selectedInfo = selected ? {
    text: selected.innerText.slice(0,120),
    attrs: Object.fromEntries(Array.from(selected.attributes).map(a => [a.name, a.value.slice(0,80)]))
  } : null;

  // Compare card classes for selected vs not
  const classSets = cards.slice(0, 5).map(c => ({
    text: c.innerText.split('\n')[0],
    className: c.className,
    ariaSelected: c.getAttribute('aria-selected'),
    ariaCurrent: c.getAttribute('aria-current'),
    ariaPressed: c.getAttribute('aria-pressed'),
  }));

  return {
    beforeId, afterId, idChanged: beforeId !== afterId,
    cardLines: beforeLines.slice(0, 10),
    aboutFound: !!about,
    aboutSection,
    blocks,
    selectedInfo,
    classSets,
  };
}
"""


def fetch_json(path: str):
    with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/{path}", timeout=5) as r:
        return json.loads(r.read())


def wait_cdp():
    for _ in range(40):
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
    profile = Path(tempfile.mkdtemp(prefix="aja-sdui2-")) / "p"
    profile.mkdir(parents=True)
    chrome = subprocess.Popen([
        str(CHROME_PATH), f"--remote-debugging-port={PORT}",
        f"--user-data-dir={profile}", "--no-first-run", "--no-default-browser-check",
        "--window-size=1400,900", "about:blank",
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        assert wait_cdp()
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
            await send("Page.navigate", {"url": "https://www.linkedin.com/jobs/search-results/?keywords=AI%20Leader&location=India"})
            await asyncio.sleep(6)
            res = await send("Runtime.evaluate", {
                "expression": f"({PROBE})()",
                "awaitPromise": True,
                "returnByValue": True,
            })
            print(json.dumps(res.get("result", {}).get("result", {}).get("value") or res, indent=2))
    finally:
        chrome.terminate()
        try: chrome.wait(timeout=5)
        except Exception: chrome.kill()


if __name__ == "__main__":
    asyncio.run(main())
