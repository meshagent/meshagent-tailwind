import React, { useMemo } from 'react';
import { Participant, participantToken, websocketRoomUrl } from '@meshagent/meshagent';
import { useRoomConnection, useWaitForAgentParticipant } from '@meshagent/meshagent-react';
import { LoadingOverlay } from "@/components/ui/spinner";

import { Chat } from '@meshagent/meshagent-tailwind';
import { ProjectConfigFormValues } from './ProjectConfigForm';

function onAuthorization(config: ProjectConfigFormValues): () => Promise<{ url: string; jwt: string }> {
    return async () => {
        const token = participantToken({
            participantName: config.userName,
            roomName: config.roomName,
            projectId: config.projectId,
            apiKeyId: config.apiKey,
        });

        const jwt = await token.toJwt({
            token: config.secret
        });

        const url = websocketRoomUrl({
            roomName: config.roomName,
            apiUrl: config.apiUrl,
        });

        return { url, jwt };
    };
}

export function ChatApp({config} : {config: ProjectConfigFormValues }): React.ReactElement {
    const path = useMemo(() => {
        const userName = config.userName.toLowerCase().replace(/[^A-Za-z0-9]+/g, '-');

        return `.threads/meshagent.chatbot-${userName}.thread`;
    }, [config.userName]);

    const connection = useRoomConnection({
        authorization: onAuthorization(config),
        enableMessaging: true,
    });

    const agent = useWaitForAgentParticipant(connection);

    const participants = useMemo<Participant[]>(() => {
        const localParticipant = connection.client?.localParticipant;

        if (!localParticipant) {
            return [];
        }

        return agent ? [agent, localParticipant] : [];
    }, [agent, connection.client]);

    return (
        <main className="flex flex-col min-h-0 flex-1">
            <LoadingOverlay isLoading={!connection.ready && agent === null} className="flex-1">
                {connection.ready && (<Chat room={connection.client!} path={path} participants={participants} />)}
            </LoadingOverlay>
        </main>
    );
}
