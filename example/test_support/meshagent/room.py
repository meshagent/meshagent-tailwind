import asyncio
from meshagent.api import (
    RoomClient,
    ParticipantToken,
    RemoteParticipant,
    WebSocketClientProtocol,
    RoomException,
    ParticipantGrant,
    ApiScope,
)
from test_support.tools.ui import UIToolkit
from test_support import config

# import ipdb

async def get_remote_participants(room: RoomClient) -> list[RemoteParticipant]:
    participants = room.messaging.remote_participants
    if participants:
        return participants

    loop = asyncio.get_running_loop()
    future: asyncio.Future = loop.create_future()

    def _handler(**_):
        participants = room.messaging.remote_participants
        if participants and not future.done():
            future.set_result(participants)

    room.messaging.on("participant_added", _handler)
    try:
        return await future
    finally:
        room.messaging.off("participant_added", _handler)


async def show_toast(
    *,
    title: str,
    description: str,
    room_name: str | None = None,
    ws_api_url: str | None = None,
    project_id: str | None = None,
    key_id: str | None = None,
    secret: str | None = None,
) -> None:
    """
    Connects, registers the UI toolkit, and invokes the show_toast tool for all remote participants.
    """
    room_name = room_name or config.ROOM_NAME
    ws_api_url = ws_api_url or config.WS_API_URL
    project_id = project_id or config.MESHAGENT_PROJECT_ID
    key_id = key_id or config.MESHAGENT_KEY_ID
    secret = secret or config.MESHAGENT_SECRET

    try:
        token = ParticipantToken(
            name="Test Agent",
            project_id=project_id,
            api_key_id=key_id,
            grants=[
                ParticipantGrant(name="room", scope=room_name),
                ParticipantGrant(name="role", scope="agent"),
            ],
        )

        token.add_api_grant(ApiScope.agent_default())

        jwt = token.to_jwt(token=secret)

        protocol = WebSocketClientProtocol(url=ws_api_url, token=jwt)

        room = RoomClient(protocol=protocol)

        async with room as client:
            await client.messaging.enable()

            participants = await get_remote_participants(client)

            toolkit = UIToolkit()

            await toolkit.start(room=client)
            print(f"Registering toolkit {toolkit.name}...")

            for participant in participants:
                print(f"Participant id '{participant.id}'")

                await room.agents.invoke_tool(
                    toolkit="ui",
                    tool="show_toast",
                    participant_id=participant.id,
                    arguments={
                        "title": title,
                        "description": description,
                    },
                )
    except RoomException as e:
        print(f"error: {e}")
