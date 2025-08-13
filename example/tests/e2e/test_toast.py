import pytest
from playwright.async_api import expect
from test_support.meshagent.room import show_toast

@pytest.mark.asyncio
async def test_toast_shown_to_user(logged_in_context):
    page = logged_in_context.pages[0]

    expected_title = "Hello from the AI Agent!"
    expected_description = "This is a message from the AI agent invoked via the chat."

    # Trigger toast through the agent/tooling
    await show_toast(title=expected_title, description=expected_description)

    toast = page.locator("[data-sonner-toast]").first
    await expect(toast).to_be_visible()
    await expect(toast).to_contain_text(expected_title)
    await expect(toast).to_contain_text(expected_description)
