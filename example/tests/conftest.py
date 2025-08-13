import pytest_asyncio
from playwright.async_api import async_playwright
from test_support import config

@pytest_asyncio.fixture(scope="function")
async def logged_in_context():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=False, devtools=True)
        context = await browser.new_context()
        page = await context.new_page()

        await page.goto(config.APP_URL)

        # Fill the app form
        await page.get_by_role("textbox", name="Project ID").fill(config.MESHAGENT_PROJECT_ID)
        await page.get_by_role("textbox", name="API Key Secret").fill(config.MESHAGENT_KEY_ID)
        await page.get_by_role("textbox", name="Enter your secret key").fill(config.MESHAGENT_SECRET)
        await page.get_by_role("textbox", name="User Name").fill(config.USER_NAME)
        await page.get_by_role("textbox", name="Room Name").fill(config.ROOM_NAME)
        await page.get_by_role("textbox", name="API URL").fill(config.MESHAGENT_URL)
        await page.get_by_role("button", name="Save Configuration").click()

        yield context

        await context.close()
        await browser.close()
