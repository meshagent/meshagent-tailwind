import React from 'react';
import { participantToken, websocketRoomUrl } from '@meshagent/meshagent';
import { useRoomConnection } from '@meshagent/meshagent-react';
import { LoadingOverlay } from "@/components/ui/spinner";

import { Chat } from '@meshagent/meshagent-tailwind';

const participantName = 'John Smith';
const roomName = 'my-room';
const path = '.threads/meshagent.chatbot-josef.kohout@timu.com.thread';

const importMetaEnv = import.meta.env as ImportMetaEnv;

const projectId = importMetaEnv['VITE_MESHAGENT_PROJECT_ID'];
const apiKeyId = importMetaEnv['VITE_MESHAGENT_KEY_ID'];
const apiUrl = importMetaEnv['VITE_MESHAGENT_API_URL'];
const secret = importMetaEnv['VITE_MESHAGENT_SECRET'];

async function onAuthorization() {
    const token = participantToken({
        participantName,
        roomName,
        projectId,
        apiKeyId,
    });

    const jwt = await token.toJwt({ token: secret });
    const url = websocketRoomUrl({ roomName, apiUrl });

    return { url, jwt };
}

export default function App(): React.ReactElement {
    const connection = useRoomConnection({
        authorization: onAuthorization,
        enableMessaging: true
    });

    return (
        <main className="h-[100vh]">
            <LoadingOverlay isLoading={!connection.ready}>
                {connection.ready && (<Chat room={connection.client!} path={path} />)}
            </LoadingOverlay>
        </main>
    );
}

