import asyncio
from playwright.async_api import async_playwright
import os

async def main():
    extension_path = os.path.join(os.getcwd(), 'extension')
    print(f"Loading extension from: {extension_path}")

    async with async_playwright() as p:
        # Launch persistent context with the extension loaded
        args = [
            f"--disable-extensions-except={extension_path}",
            f"--load-extension={extension_path}",
            "--disable-blink-features=AutomationControlled"
        ]
        
        # Determine Chrome executable path for macOS
        executable_path = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
        if not os.path.exists(executable_path):
             print("Could not find Google Chrome. Trying without executable_path...")
             executable_path = None

        print("Launching browser...")
        context = await p.chromium.launch_persistent_context(
            user_data_dir="/tmp/playwright_test_profile",
            executable_path=executable_path,
            headless=False, # Extensions only load in headed mode
            args=args,
            ignore_https_errors=True
        )

        page = context.pages[0] if context.pages else await context.new_page()

        # Capture console messages
        def handle_console(msg):
            print(f"[BROWSER CONSOLE] {msg.type}: {msg.text}")
        
        page.on("console", handle_console)
        page.on("pageerror", lambda err: print(f"[BROWSER ERROR] {err.message}"))

        print("Navigating to LinkedIn Jobs...")
        response = await page.goto('https://www.linkedin.com/jobs/search/', wait_until='domcontentloaded')
        print(f"Page loaded with status: {response.status if response else 'Unknown'}")

        print("Waiting 10 seconds for extension scripts to inject and run...")
        await asyncio.sleep(10)

        # Let's try to find the extension popup or background page later if needed
        # For now, just seeing the LinkedIn console logs will tell us if content_linkedin.js loaded

        print("Closing browser...")
        await context.close()

if __name__ == "__main__":
    asyncio.run(main())
