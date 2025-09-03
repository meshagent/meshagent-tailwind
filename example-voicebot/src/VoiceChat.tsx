import React, { useMemo } from 'react';

import {
    Participant,
    RemoteParticipant,
    participantToken,
    websocketRoomUrl,
} from '@meshagent/meshagent';

import {
    useRoomConnection,
    useRoomParticipants,
} from '@meshagent/meshagent-react';

import { Chat } from '@meshagent/meshagent-tailwind';

import { Loader2 } from 'lucide-react';

import { LoadingOverlay } from './components/ui/spinner';
import { Card, CardContent } from './components/ui/card';
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

export function WaitingForAgent() {
  return (
    <div>
      <Card className="w-full max-w-md mx-auto mt-8">
        <CardContent className="flex flex-col items-center justify-center space-y-4 py-8">
          <p className="text-center text-lg font-medium text-gray-700">
            We are waiting for agent to join the room
          </p>
          <Loader2 className="h-8 w-8 animate-spin" />
        </CardContent>
      </Card>
    </div>
  );
}

function getAgent(participants: Iterable<Participant>): RemoteParticipant | null {
    for (const participant of participants) {
        const p = participant as RemoteParticipant;

        if (p.role === 'agent') {
            return p;
        }
    }

    return null;
}

export function VoiceChat({config} : {config: ProjectConfigFormValues }): React.ReactElement {
    const connection = useRoomConnection({
        authorization: onAuthorization(config),
        enableMessaging: true,
    });

    const roomParticipants = useRoomParticipants(connection.client);

    const agent = useMemo(() => getAgent(roomParticipants), [roomParticipants]);

    // const livekitParticipant = useLivekitRoomParticipants(connection.client);

    // console.log('jkkkk Agent:', livekitParticipant);

    return (
        <main className="flex flex-col min-h-0 flex-1">
            <LoadingOverlay isLoading={!connection.ready} className="flex-1">
                {connection.ready ? (
                    <div>Ready</div>
                ) : (
                    <div>Waiting</div>
                )}
            </LoadingOverlay>
        </main>
    );
}
