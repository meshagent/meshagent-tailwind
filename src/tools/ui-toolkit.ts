import { RoomClient, RemoteToolkit } from '@meshagent/meshagent';
import { AskUser } from './ask-user';

export class UIToolkit extends RemoteToolkit {
    constructor({room}:  {room: RoomClient}) {
        super({
            name: "ui",
            title: "UI Tools",
            description: "User interface tools",
            room,
            tools: [
                // Add your tool instances here, e.g.:
                new AskUser(),
                // new AskUserForFile({context}),
                // new ShowAlert({context}),
                // new ShowErrorAlert({context}),
                // new Toast({context}),
                // new DisplayDocument({context}),
                // new DisplaySlide({context}),
            ]
        });
    }
}

