from typing import Any
from meshagent.tools import Tool, RemoteToolkit
from meshagent.api import JsonContent

toastSchema = {
    "type": "object",
    "additionalProperties": False,
    "required": ["title", "description"],
    "properties": {
        "title": {"type": "string", "description": "toast title"},
        "description": {"type": "string", "description": "toast body"},
    },
}

askUserSchema = {
    "type": "object",
    "additionalProperties": False,
    "required": ["subject", "form", "help"],
    "properties": {
        "subject": {"type": "string"},
        "help": {"type": "string"},
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
                                "required": [
                                    "multiline",
                                    "name",
                                    "description",
                                    "default_value",
                                ],
                                "properties": {
                                    "name": {"type": "string"},
                                    "description": {"type": "string"},
                                    "multiline": {"type": "boolean"},
                                    "default_value": {"type": "string"},
                                },
                            }
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
                            }
                        },
                    },
                    {
                        "type": "object",
                        "additionalProperties": False,
                        "required": ["radio_group"],
                        "properties": {
                            "radio_group": {
                                "type": "object",
                                "additionalProperties": False,
                                "required": [
                                    "name",
                                    "default_value",
                                    "description",
                                    "options",
                                ],
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
                            }
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
                                "required": [
                                    "name",
                                    "options",
                                    "description",
                                    "default_value",
                                ],
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
                            }
                        },
                    },
                ]
            },
        },
    },
}


class AskUser(Tool):
    def __init__(
        self,
        *,
        name: str = "ask_user",
        description: str = "ask user question",
        title: str = "Ask User",
    ):
        super().__init__(
            name=name, description=description, title=title, input_schema=askUserSchema
        )

    async def execute(self, context: Any, **kwargs: Any):
        return JsonContent(
            json={
                "subject": kwargs.get("subject", ""),
                "form": kwargs.get("form", []),
                "help": kwargs.get("help", ""),
            }
        )


class Toast(Tool):
    def __init__(
        self,
        *,
        name: str = "show_toast",
        description: str = "let the user know something important (will be shown as a toast)",
        title: str = "show user a toast",
    ):
        super().__init__(
            name=name, description=description, title=title, input_schema=toastSchema
        )

    async def execute(self, context: Any, **kwargs: Any):
        print(
            f"Showing toast with title: {kwargs.get('title', '')} and description: {kwargs.get('description', '')}"
        )
        return JsonContent(
            json={
                "title": kwargs.get("title", ""),
                "description": kwargs.get("description", ""),
            }
        )


class UIToolkit(RemoteToolkit):
    def __init__(self):
        super().__init__(
            name="ui",
            title="UI Toolkit",
            description="Toolkit for UI related tools",
            tools=[AskUser(), Toast()],
        )
