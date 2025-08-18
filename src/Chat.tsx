import { useMemo, useCallback } from "react";
import { RoomClient, Participant } from "@meshagent/meshagent";
import { useChat, useClientToolkits, useRoomIndicators } from "@meshagent/meshagent-react";

import { ChatThread } from "./ChatThread";
import { ChatInput } from "./ChatInput";
import { ChatTypingIndicator } from "./ChatTypingIndicator";

import { UIToolkit } from "./tools/ui-toolkit";
import { Toaster } from "./components/ui/sonner";

export interface ChatProps {
    room: RoomClient;
    path: string;
    participants?: Participant[];
}

export function Chat({room, path, participants}: ChatProps) {
    const {
        messages,
        sendMessage,
        selectAttachments,
        attachments,
        setAttachments,
        schemaFileExists,
        cancelRequest,
    } = useChat({room, path, participants});

    const { thinking } = useRoomIndicators({ room, path });

    const toolkits = useMemo(() => [
        new UIToolkit({room}),
    ], [room]);

    useClientToolkits({ toolkits, public: true });

    const onTextChange = useCallback((_: string) => {
        const removeParticipant = room.messaging.remoteParticipants;

        for (const part of removeParticipant) {
            room.messaging.sendMessage({
                to: part,
                type: "typing",
                message: { path },
            });
        }
    }, [room, path]);

    const localParticipantName = room?.localParticipant?.getAttribute("name");

    if (schemaFileExists === false) {
        return (
            <div className="flex flex-col flex-1 min-h-0 gap-2 p-4">
                <p className="text-red-500">
                    No AI agent found in this room.

                    Run `meshagent chatbot join --room [room-name] --agent-name "Chat Agent" --name "Chat Friend"` and try again.
                </p>
            </div>
        );
    }

    return (
        <div className="flex flex-col flex-1 min-h-0 gap-2 p-0">
            <ChatThread
                room={room}
                messages={messages}
                localParticipantName={localParticipantName} />

            <ChatTypingIndicator room={room} path={path} />

            <ChatInput
                onSubmit={sendMessage}
                attachments={attachments}
                onFilesSelected={selectAttachments}
                setAttachments={setAttachments}
                onTextChange={onTextChange} 
                onCancelRequest={cancelRequest}
                showCancelButton={thinking} />

            <Toaster />
        </div>
    );
}
