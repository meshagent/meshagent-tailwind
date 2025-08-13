import os

# Basic config (env overrides are handy for CI and local tweaks)
ROOM_NAME = os.getenv("ROOM_NAME", "room-1")
USER_NAME = os.getenv("USER_NAME", "John Doe")
MESHAGENT_URL = os.getenv("MESHAGENT_URL", "http://localhost:8080")  # UI field
WS_API_URL = os.getenv("WS_API_URL", f"ws://localhost:8080/rooms/{ROOM_NAME}")  # ws
MESHAGENT_KEY_ID = os.getenv("MESHAGENT_KEY_ID", "testkey")
MESHAGENT_PROJECT_ID = os.getenv("MESHAGENT_PROJECT_ID", "testproject")
MESHAGENT_SECRET = os.getenv("MESHAGENT_SECRET", "testsecret")
APP_URL = os.getenv("APP_URL", "http://localhost:8081/")  # your web UI under test
