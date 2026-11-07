import asyncio
import json
from pathlib import Path

from playwright.async_api import async_playwright


ROOT = Path(__file__).resolve().parents[1]
SIDEPANEL_URL = (ROOT / "sidepanel" / "sidepanel.html").as_uri()
CHROME_PATH = Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
CONSENT_VERSION = 1


def browser_mock(storage):
    return f"""
      (() => {{
        const initial = {json.dumps(storage)};
        globalThis.__mockStorage = JSON.parse(JSON.stringify(initial));
        globalThis.__fetchCalls = [];
        globalThis.__createdTabs = [];
        globalThis.__downloads = [];
        globalThis.__runtimeMessages = [];
        globalThis.__xssExecuted = false;
        globalThis.fetch = async (url, options = {{}}) => {{
          globalThis.__fetchCalls.push({{ url: String(url), options }});
          return {{ ok: true, status: 200, json: async () => ({{ status: 'synced' }}) }};
        }};
        const getValues = (keys) => {{
          if (keys == null) return {{ ...globalThis.__mockStorage }};
          if (typeof keys === 'string') return {{ [keys]: globalThis.__mockStorage[keys] }};
          if (Array.isArray(keys)) return Object.fromEntries(keys.map(k => [k, globalThis.__mockStorage[k]]));
          return Object.fromEntries(Object.entries(keys).map(([k, fallback]) => [k, globalThis.__mockStorage[k] ?? fallback]));
        }};
        globalThis.chrome = {{
          runtime: {{
            lastError: null,
            onMessage: {{ addListener(listener) {{ globalThis.__runtimeListener = listener; }} }},
            sendMessage(message, callback) {{
              globalThis.__runtimeMessages.push(message);
              const response = {{ success: true }};
              if (callback) queueMicrotask(() => callback(response));
              return Promise.resolve(response);
            }}
          }},
          storage: {{ local: {{
            get(keys, callback) {{
              const result = getValues(keys);
              if (callback) queueMicrotask(() => callback(result));
              return Promise.resolve(result);
            }},
            set(values, callback) {{
              Object.assign(globalThis.__mockStorage, values);
              if (callback) queueMicrotask(callback);
              return Promise.resolve();
            }},
            remove(keys, callback) {{
              for (const key of (Array.isArray(keys) ? keys : [keys])) delete globalThis.__mockStorage[key];
              if (callback) queueMicrotask(callback);
              return Promise.resolve();
            }}
          }}}},
          tabs: {{
            query(_query, callback) {{ callback([{{ id: 1, url: 'https://www.linkedin.com/jobs/' }}]); }},
            create(options) {{ globalThis.__createdTabs.push(options); }},
            update() {{}},
            reload() {{}}
          }},
          downloads: {{ download(options) {{ globalThis.__downloads.push(options); }} }}
        }};
      }})();
    """


async def open_panel(browser, storage):
    page = await browser.new_page()
    await page.add_init_script(script=browser_mock(storage))
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    await page.goto(SIDEPANEL_URL)
    await page.wait_for_load_state("domcontentloaded")
    await page.wait_for_timeout(50)
    assert not errors, f"Side panel JavaScript errors: {errors}"
    return page


async def test_consent(browser):
    # New users default off and saving locally does not synchronize.
    page = await open_panel(browser, {})
    await page.locator("#navProfile").click()
    assert not await page.locator("#shareAnonymized").is_checked()
    await page.locator("#resumeSummary").fill("Python engineer")
    await page.locator("#saveProfileBtn").click()
    await page.wait_for_timeout(50)
    assert await page.evaluate("__fetchCalls.length") == 0
    await page.close()

    # Legacy and version-mismatched values require fresh confirmation.
    for legacy in [
        {"shareAnonymized": True, "resumeSummary": "Legacy profile"},
        {"shareAnonymized": True, "shareConsentVersion": 0, "resumeSummary": "Old consent"},
    ]:
        page = await open_panel(browser, legacy)
        await page.locator("#navProfile").click()
        assert not await page.locator("#shareAnonymized").is_checked()
        consent_text = await page.locator(".consent-detail").inner_text()
        assert "does not delete information already shared" in consent_text
        assert await page.evaluate("__fetchCalls.length") == 0
        await page.close()

    # Explicit opt-in persists the version, synchronizes, and survives a new panel load.
    page = await open_panel(browser, {"resumeSummary": "Python engineer"})
    await page.locator("#navProfile").click()
    await page.locator("#shareAnonymized").check()
    await page.locator("#saveProfileBtn").click()
    await page.wait_for_timeout(50)
    persisted = await page.evaluate("JSON.parse(JSON.stringify(__mockStorage))")
    assert persisted["shareAnonymized"] is True
    assert persisted["shareConsentVersion"] == CONSENT_VERSION
    assert await page.evaluate("__fetchCalls.length") == 1
    await page.close()

    page = await open_panel(browser, persisted)
    await page.locator("#navProfile").click()
    assert await page.locator("#shareAnonymized").is_checked()
    await page.close()

    # Explicit opt-out persists and prevents future synchronization.
    page = await open_panel(browser, {
        "shareAnonymized": True,
        "shareConsentVersion": CONSENT_VERSION,
        "resumeSummary": "Python engineer",
    })
    await page.locator("#navProfile").click()
    await page.locator("#shareAnonymized").uncheck()
    await page.locator("#saveProfileBtn").click()
    await page.wait_for_timeout(50)
    assert await page.evaluate("__mockStorage.shareAnonymized") is False
    assert await page.evaluate("__fetchCalls.length") == 0
    await page.close()


async def test_xss_and_saved_jobs(browser):
    payloads = [
        "<script>globalThis.__xssExecuted=true</script>",
        "<img src=x onerror=globalThis.__xssExecuted=true>",
        "<svg onload=globalThis.__xssExecuted=true>",
    ]
    malicious_job = {
        "title": payloads[0],
        "company": payloads[1],
        "location": payloads[2],
        "applyUrl": "javascript:globalThis.__xssExecuted=true",
        "description": payloads[2],
        "evaluation": {
            "score": 75,
            "skillsScore": 80,
            "reqsScore": 70,
            "respScore": None,
            "reasoning": payloads[1],
            "matchedSkills": [payloads[0]],
            "missingSkills": [payloads[1]],
            "requirements": [{"text": payloads[2], "priority": "critical", "matched": False}],
            "responsibilities": [],
            "scoreCoverage": {"assessedDimensions": 2, "totalDimensions": 3, "status": "partial"},
        },
    }
    saved = {
        **malicious_job,
        "url": "https://example.com/jobs/valid",
        "applyUrl": "https://example.com/jobs/valid",
        "contactEmail": payloads[2],
        "reasoning": payloads[1],
        "coverLetter": payloads[0],
        "score": 75,
        "skillsScore": 80,
        "reqsScore": 70,
        "respScore": None,
        "scoreCoverage": {"assessedDimensions": 2, "totalDimensions": 3, "status": "partial"},
        "matchedSkills": [payloads[0]],
        "missingSkills": [payloads[1]],
        "savedAt": "2026-11-07T00:00:00.000Z",
    }
    legacy_saved = {
        "title": "Legacy job",
        "company": "Example",
        "url": "https://example.com/legacy",
        "score": 50,
        "savedAt": "2026-11-07T00:00:00.000Z",
    }
    page = await open_panel(browser, {"lastJob": malicious_job, "savedJobs": [saved, legacy_saved]})

    assert await page.locator("#jobTitleText").inner_text() == payloads[0]
    assert await page.locator("#jobCompanyText").inner_text() == payloads[1]
    assert await page.locator("#reasoningText").inner_text() == payloads[1]
    assert await page.locator("#skillsChips").inner_text()
    assert await page.locator("#savedJobsList").inner_text()
    assert await page.locator("#analysisView script, #analysisView img, #analysisView svg").count() == 0
    assert await page.locator("#savedJobsList script, #savedJobsList img, #savedJobsList svg").count() == 0
    assert await page.evaluate("__xssExecuted") is False
    assert not await page.locator("#jobApplyLink").is_visible()

    valid_link = page.locator("#savedJobsList a.sj-apply-btn").first
    assert await valid_link.get_attribute("href") == "https://example.com/jobs/valid"
    assert await valid_link.get_attribute("rel") == "noopener noreferrer"
    saved_text = await page.locator("#savedJobsList").inner_text()
    assert "Coverage 2/3 partial" in saved_text
    assert "Coverage: Legacy" in saved_text  # legacy records with no scoreCoverage are labelled, not inferred
    await page.close()


async def test_manual_save_and_csv(browser):
    job = {
        "id": "job-1",
        "title": "Python Engineer",
        "company": "Example",
        "location": "Remote",
        "url": "https://example.com/jobs/1",
        "applyUrl": "https://example.com/jobs/1",
        "evaluation": {
            "score": 80,
            "skillsScore": 100,
            "reqsScore": 60,
            "respScore": None,
            "matchedSkills": ["Python"],
            "missingSkills": [],
            "requirements": [],
            "responsibilities": [],
            "scoreCoverage": {"assessedDimensions": 2, "totalDimensions": 3, "status": "partial"},
        },
    }
    page = await open_panel(browser, {"lastJob": job, "savedJobs": []})
    await page.locator("#saveJobBtn").click()
    await page.wait_for_timeout(50)
    saved = await page.evaluate("__mockStorage.savedJobs")
    assert len(saved) == 1
    assert saved[0]["scoreCoverage"]["status"] == "partial"
    await page.locator("#navSaved").click()
    assert "Coverage 2/3 partial" in await page.locator("#savedJobsList").inner_text()
    await page.locator("#exportCsvBtn").click()
    assert await page.evaluate("__downloads.length") == 1
    await page.close()


async def main():
    async with async_playwright() as playwright:
        launch_args = {"headless": True}
        if CHROME_PATH.exists():
            launch_args["executable_path"] = str(CHROME_PATH)
        browser = await playwright.chromium.launch(**launch_args)
        try:
            await test_consent(browser)
            await test_xss_and_saved_jobs(browser)
            await test_manual_save_and_csv(browser)
        finally:
            await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
