import React, { useMemo, useState, useEffect } from 'react';
import { Participant, participantToken, websocketRoomUrl } from '@meshagent/meshagent';
import { useRoomConnection } from '@meshagent/meshagent-react';
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

        const jwt = await token.toJwt({ token: config.secret });
        const url = websocketRoomUrl({
            roomName: config.roomName,
            apiUrl: 'https://api.meshagent.life',
        });

        return { url, jwt };
    };
}

export function ChatApp({config} : {config: ProjectConfigFormValues }): React.ReactElement {
    const [agent, setAgent] = useState<Participant| null>(null);

    const path = useMemo(() => {
        const userName = config.userName.toLowerCase().replace(/[^A-Za-z0-9]+/g, '-');

        return `.threads/meshagent.chatbot-${userName}.thread`;
    }, [config.userName]);

    const connection = useRoomConnection({
        authorization: onAuthorization(config),
        enableMessaging: true
    });

    useEffect(() => {
        if (!connection.ready) {
            return;
        }

        function onChange() {
            const participants = Array.from(connection.client!.messaging.remoteParticipants);

            const agentParticipant = participants.find(p => p.role === 'agent');

            if (agentParticipant) {
                setAgent(agentParticipant);
            }
        }

        connection.client!.messaging.on('change', onChange);

        onChange();

        return () => connection.client!.messaging.off('change', onChange);
    }, [connection, connection.ready]);

    const participants = useMemo<Participant[]>(() => agent ? [agent] : [], [agent]);

    return (
        <main className="flex flex-col min-h-0">
            <LoadingOverlay isLoading={!connection.ready && agent === null} className="flex-1">
                {connection.ready && (<Chat room={connection.client!} path={path} participants={participants} />)}
            </LoadingOverlay>
        </main>
    );
}

