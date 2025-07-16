import * as React from 'react';
import { Circle } from 'lucide-react';

import { RoomClient } from '@meshagent/meshagent';
import { useRoomIndicators } from '@meshagent/meshagent-react';

export interface ChatTypingIndicatorProps {
    room: RoomClient | null;
    path: string;
}

export function ChatTypingIndicator({room, path}: ChatTypingIndicatorProps): React.ReactElement | null {
    const { typing } = useRoomIndicators({ room, path });

    return typing ? (
        <div className="flex items-end space-x-1 h-6 p-6">
            {[0, 1, 2].map((index) => (
                <Circle
                    key={index}
                    className="w-2 h-2 text-gray-500"
                    style={{
                        animation: 'typingBounce 0.6s ease-in-out infinite',
                        animationDelay: `${index * 0.2}s`,
                    }}
                />
            ))}
            {/* Inline keyframes for bounce */}
            <style>{`
                @keyframes typingBounce {
                    0%, 100% { transform: translateY(0); }
                    50% { transform: translateY(-4px); }
                }
                `}</style>
        </div>
    ) : null;
};
