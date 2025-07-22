import { RoomClient, Participant } from "@meshagent/meshagent";
import { useChat } from "@meshagent/meshagent-react";

import { ChatThread } from "./ChatThread";
import { ChatInput } from "./ChatInput";
import { ChatTypingIndicator } from "./ChatTypingIndicator";

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
    } = useChat({room, path, participants});

    const localParticipantName = room.localParticipant!.getAttribute("name");

    return (
        <div className="flex flex-col flex-1 min-h-0 gap-2 p-0">
            <ChatThread
                room={room}
                messages={messages}
                localParticipantName={localParticipantName}
            />
            <ChatTypingIndicator room={room} path={path} />
            <ChatInput
                onSubmit={sendMessage}
                attachments={attachments}
                onFilesSelected={selectAttachments}
                setAttachments={setAttachments}
            />
        </div>
    );
}
