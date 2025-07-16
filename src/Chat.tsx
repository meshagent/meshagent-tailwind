import { RoomClient } from '@meshagent/meshagent';
import { useChat } from "@meshagent/meshagent-react";

import { ChatThread } from "./ChatThread";
import { ChatInput } from "./ChatInput";
import { ChatTypingIndicator } from "./ChatTypingIndicator";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card";

export interface ChatProps {
    room: RoomClient;
    path: string;
}

export function Chat({room, path}: ChatProps) {
    const {
        messages,
        sendMessage,
        selectAttachments,
    } = useChat({room, path});

    const localParticipantName = room.localParticipant!.getAttribute("name");

    return (
        <Card className="flex flex-col h-full">
            <CardHeader className="border-b">
                <CardTitle>Chat</CardTitle>
            </CardHeader>

            <CardContent className="flex flex-col flex-1 gap-2 p-0">
                <ChatThread messages={messages} localParticipantName={localParticipantName} />
                <ChatTypingIndicator room={room} path={path} />
                <ChatInput onSubmit={sendMessage} onFilesSelected={selectAttachments} />
            </CardContent>
        </Card>
    );
}
