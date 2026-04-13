import * as React from "react";
import { Participant, RoomClient } from "@meshagent/meshagent";
import { useClientToolkits, useRoomIndicators } from "@meshagent/meshagent-react";

import { ChatInput } from "./ChatInput";
import { ChatThread } from "./ChatThread";
import { Toaster } from "./components/ui/sonner";
import { UIToolkit } from "./tools/ui-toolkit";
import { useChatThread, useThreadStatus } from "./chat-hooks";

export interface ChatProps {
    room: RoomClient;
    path: string;
    participants?: Participant[];
}

export function Chat({ room, path, participants }: ChatProps): React.ReactElement {
    const {
        messages,
        sendMessage,
        selectAttachments,
        attachments,
        setAttachments,
        schemaFileExists,
        onlineParticipants,
        localParticipantName,
        cancelRequest,
    } = useChatThread({ room, path, participants });
    const { typing, thinking } = useRoomIndicators({ room, path });
    const threadStatus = useThreadStatus({ room, path });
    const [showCompletedToolCalls, setShowCompletedToolCalls] = React.useState(false);

    const toolkits = React.useMemo(() => [new UIToolkit({ room })], [room]);
    useClientToolkits({ toolkits, public: false });

    const onTextChange = React.useCallback(() => {
        for (const participant of onlineParticipants) {
            room.messaging.sendMessage({
                to: participant,
                type: "typing",
                message: { path },
            });
        }
    }, [onlineParticipants, path, room]);

    if (schemaFileExists === false) {
        return (
            <div className="flex flex-1 flex-col justify-center p-6">
                <div className="mx-auto w-full max-w-[912px] rounded-3xl border border-destructive/30 bg-destructive/5 px-6 py-5 text-sm text-destructive">
                    No AI agent found in this room.
                    <br />
                    <br />
                    Run `meshagent chatbot join --room [room-name] --agent-name "Chat Agent" --name "Chat Friend"` and try again.
                </div>
            </div>
        );
    }

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <ChatThread
                room={room}
                path={path}
                messages={messages}
                localParticipantName={localParticipantName}
                showCompletedToolCalls={showCompletedToolCalls}
                onShowCompletedToolCallsChanged={setShowCompletedToolCalls}
                typing={typing}
                thinking={thinking}
                threadStatusText={threadStatus.text}
                threadStatusStartedAt={threadStatus.startedAt}
                threadStatusMode={threadStatus.mode}
                onCancelRequest={cancelRequest}
            />

            <ChatInput
                onSubmit={sendMessage}
                attachments={attachments}
                onFilesSelected={selectAttachments}
                setAttachments={setAttachments}
                onTextChange={onTextChange}
            />

            <Toaster />
        </div>
    );
}
