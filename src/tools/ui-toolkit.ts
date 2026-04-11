import { Toolkit } from '@meshagent/meshagent';

import { AskUser } from './ask-user';
import { AskUserForFile } from './ask-user-for-file';
import { DisplayDocument } from './display-document';
import { Toast } from './toast';

export class UIToolkit extends Toolkit {
    constructor() {
        super({
            name: "ui",
            title: "UI Tools",
            description: "User interface tools",
            tools: [
                new AskUser(),
                new AskUserForFile(),
                new Toast(),
                new DisplayDocument(),
            ]
        });
    }
}
