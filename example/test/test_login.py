import asyncio
from typing import Any

import pytest
import pytest_asyncio

from playwright.async_api import async_playwright, expect

from meshagent.api import (
    RoomClient, ParticipantToken,
    RemoteParticipant, 
    WebSocketClientProtocol, RoomException,
    ParticipantGrant, JsonResponse, ApiScope
)

from meshagent.tools import Tool, RemoteToolkit

room_name = "room-1"
user_name = "John Doe"
api_url=f"ws://localhost:8080/rooms/{room_name}"
meshagent_url = "http://localhost:8080"
meshagent_key_id = "testkey"
meshagent_project_id = "testproject"
meshagent_secret="testsecret"

toast_title = "Hello from the AI Agent!"
toast_description = "This is a message from the AI agent invoked via the chat."

toastSchema = {
    "type": "object",
    "additionalProperties": False,
    "required": ["title", "description"],
    "properties": {
        "title": {
            "type": "string",
            "description": "a very short summary suitable for a toast title",
        },
        "description": {
            "type": "string",
            "description": "a longer description that explains the toast message in more detail",
        },
    }
}

askUserSchema = {
    "type": "object",
    "additionalProperties": False,
    "required": ["subject", "form", "help"],
    "properties": {
        "subject": {
            "type": "string",
            "description": "a very short description suitable for a dialog title"
        },
        "help": {
            "type": "string",
            "description": "helpful information that explains why this information is being collected and how it will be used",
        },
        "form": {
            "type": "array",
            "items": {
                "anyOf": [
                    {
                        "type": "object",
                        "additionalProperties": False,
                        "required": ["input"],
                        "properties": {
                            "input": {
                                "type": "object",
                                "additionalProperties": False,
                                "required": ["multiline", "name", "description", "default_value"],
                                "properties": {
                                    "name": {"type": "string"},
                                    "description": {"type": "string"},
                                    "multiline": {"type": "boolean"},
                                    "default_value": {"type": "string"},
                                },
                            },
                        },
                    },
                    {
                        "type": "object",
                        "additionalProperties": False,
                        "required": ["checkbox"],
                        "properties": {
                            "checkbox": {
                                "type": "object",
                                "additionalProperties": False,
                                "required": ["name", "description", "default_value"],
                                "properties": {
                                    "name": {"type": "string"},
                                    "description": {"type": "string"},
                                    "default_value": {"type": "boolean"},
                                },
                            },
                        },
                    },
                    {
                        "type": "object",
                        "additionalProperties": False,
                        "required": ["radio_group"],
                        "description":
                            "allows the user to select a single option from a list of options. best for multiple choice questions or surveys",
                        "properties": {
                            "radio_group": {
                                "type": "object",
                                "additionalProperties": False,
                                "required": ["name", "default_value", "description", "options"],
                                "properties": {
                                    "name": {"type": "string"},
                                    "description": {"type": "string"},
                                    "default_value": {"type": "string"},
                                    "options": {
                                        "type": "array",
                                        "items": {
                                            "type": "object",
                                            "additionalProperties": False,
                                            "required": ["name", "value"],
                                            "properties": {
                                                "name": {"type": "string"},
                                                "value": {"type": "string"},
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                    {
                        "type": "object",
                        "additionalProperties": False,
                        "required": ["select"],
                        "properties": {
                            "select": {
                                "type": "object",
                                "additionalProperties": False,
                                "required": ["name", "options", "description", "default_value"],
                                "properties": {
                                    "name": {"type": "string"},
                                    "description": {"type": "string"},
                                    "default_value": {"type": "string"},
                                    "options": {
                                        "type": "array",
                                        "items": {
                                            "type": "object",
                                            "additionalProperties": False,
                                            "required": ["name", "value"],
                                            "properties": {
                                                "name": {"type": "string"},
                                                "value": {"type": "string"},
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                ],
            },
        },
    },
}

class AskUser(Tool):
    """
    Ask the user for information using a form.
    """

    def __init__(self, *, name: str = "ask_user", description: str = "ask user question", title: str = "Ask User"):
        super().__init__(
                name=name,
                description=description,
                title=title,
                input_schema=askUserSchema)

    async def execute(self, context: Any, **kwargs: Any):
        return JsonResponse(json={
            "subject": kwargs.get("subject", ""),
            "form": kwargs.get("form", []),
            "help": kwargs.get("help", ""),
        })

class Toast(Tool):
    """
    Show a toast message to the user.
    """

    def __init__(self, *, 
         name: str = "show_toast",
         description: str = "let the user know something important (will be shown as a toast)",
         title: str = "show user a toast"):

        super().__init__(
                name=name,
                description=description,
                title=title,
                input_schema=toastSchema)

    async def execute(self, context: Any, **kwargs: Any):
        print(f"Showing toast with title: {kwargs.get('title', '')} and description: {kwargs.get('description', '')}")

        return JsonResponse(json={
            "title": kwargs.get("title", ""),
            "description": kwargs.get("description", ""),
        })



class UIToolkit(RemoteToolkit):
    """
    Toolkit for UI related tools.
    """

    def __init__(self):
        super().__init__(
            name="ui",
            title="UI Toolkit",
            description="Toolkit for UI related tools",
            tools=[
                AskUser(),
                Toast(),
            ],
        )

async def get_remote_participants(room: RoomClient) -> list[RemoteParticipant]:
    participants = room.messaging.remote_participants

    print(f"Remote participants: {participants}")

    if participants:
        return participants

    loop = asyncio.get_running_loop()
    future: asyncio.Future = loop.create_future()

    print("Waiting for participant to join the room...")

    def _handler(**_):
        participants = room.messaging.remote_participants

        if participants and not future.done():
            future.set_result(participants)

    room.messaging.on('participant_added', _handler)

    try:
        return await future

    finally:
        room.messaging.off('participant_added', _handler)


async def show_toast():
    """
    Show a toast message to the user.
    """
    try:
        print(f"Connecting to room {room_name} at {api_url}...")

        token = ParticipantToken(
                name="Test Agent",
                project_id=meshagent_project_id,
                api_key_id=meshagent_key_id,
                grants=[
                    ParticipantGrant(name="room", scope=room_name),
                    ParticipantGrant(name="role", scope="agent"),
                ])

        token.add_api_grant(ApiScope.agent_default())

        jwt = token.to_jwt(token=meshagent_secret)

        protocol = WebSocketClientProtocol(url=api_url, token=jwt)

        room = RoomClient(protocol=protocol)

        async with room as client:
            await client.messaging.enable()

            # Wait for participant to be added
            participants = await get_remote_participants(client)

            toolkit = UIToolkit()

            await toolkit.start(room=client)
            print(f"Registering toolkit {toolkit.name}...")

            toolkits = await room.agents.list_toolkits()
            print(f"1 Available toolkits: {toolkits}")

            for participant in participants:
                print(f"Participant id '{participant.id}'")

                await room.agents.invoke_tool(
                    toolkit="ui",
                    tool="show_toast",
                    participant_id=participant.id,
                    arguments={
                        "title": toast_title,
                        "description": toast_description,
                    })

    except RoomException as e:
        print(f"error: {e}")

@pytest_asyncio.fixture(scope="function")
async def logged_in_context():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=False, devtools=True)
        context = await browser.new_context()
        page = await context.new_page()

        await page.goto("http://localhost:8081/")

        await page.get_by_role("textbox", name="Project ID").click()
        await page.get_by_role("textbox", name="Project ID").fill(meshagent_project_id)
        await page.get_by_role("textbox", name="Project ID").press("Tab")
        await page.get_by_role("textbox", name="API Key Secret").fill(meshagent_key_id)
        await page.get_by_role("textbox", name="API Key Secret").press("Tab")
        await page.get_by_role("textbox", name="Enter your secret key").fill(meshagent_secret)
        await page.get_by_role("textbox", name="Enter your secret key").press("Tab")
        await page.get_by_role("textbox", name="User Name").fill(user_name)
        await page.get_by_role("textbox", name="User Name").press("Tab")
        await page.get_by_role("textbox", name="Room Name").fill(room_name)
        await page.get_by_role("textbox", name="Room Name").press("Tab")
        await page.get_by_role("textbox", name="API URL").fill(meshagent_url)
        await page.get_by_role("button", name="Save Configuration").click() 

        yield context

        await context.close()
        await browser.close()

@pytest.mark.asyncio
async def test_with_login(logged_in_context):
    page = logged_in_context.pages[0]

    # Call the show_toast function
    await show_toast()

    toast = page.locator("[data-sonner-toast]").first
    await expect(toast).to_be_visible()
    await expect(toast).to_contain_text(toast_title)
    await expect(toast).to_contain_text(toast_description)
