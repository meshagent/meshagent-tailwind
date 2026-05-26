import { Toolkit } from "@meshagent/meshagent";

import { AskUser } from './ask-user.js';
import { AskUserForFile } from './ask-user-for-file.js';
import { DisplayDocument } from './display-document.js';
import { Toast } from './toast.js';

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
            ],
            rules: [],
        });
    }
}
