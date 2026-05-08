export class Address {
    public readonly mailAddress: string;
    public readonly name: string | null;

    private static readonly quotableNameRegExp = /[",]/u;

    constructor(mailAddress: string, name: string | null = null) {
        this.mailAddress = mailAddress;
        this.name = name;
    }

    get sanitizedName(): string | null {
        if (this.name == null) {
            return null;
        }

        if (Address.quotableNameRegExp.test(this.name)) {
            return `"${this.name.replace(/"/gu, '\\"')}"`;
        }

        return this.name;
    }

    get sanitizedAddress(): string {
        return this.mailAddress;
    }

    toString(): string {
        return this.name == null ? this.mailAddress : `${this.name} <${this.mailAddress}>`;
    }
}

export function parseEmailList(addresses: string): Address[] {
    const result: Address[] = [];
    const nameOrEmail: string[] = [];
    const email: string[] = [];
    const name: string[] = [];

    let inQuote = false;
    let inAngleBrackets = false;

    const addAddress = (): void => {
        if (nameOrEmail.length > 0) {
            if (email.length === 0) {
                email.push(...nameOrEmail);
            } else if (name.length === 0) {
                name.push(...nameOrEmail);
            }
        }

        if (email.length > 0) {
            const parsedName = name.join("").trim();
            result.push(new Address(email.join("").trim(), parsedName === "" ? null : parsedName));
        }

        email.length = 0;
        name.length = 0;
        nameOrEmail.length = 0;
        inAngleBrackets = false;
        inQuote = false;
    };

    for (let index = 0; index < addresses.length; index += 1) {
        const char = addresses[index];

        if (inQuote) {
            if (char === '"') {
                inQuote = false;
            } else if (char === "\\") {
                index += 1;
                if (index < addresses.length) {
                    name.push(addresses[index] ?? "");
                }
            } else if (char != null) {
                name.push(char);
            }
        } else if (inAngleBrackets) {
            if (char === ">") {
                inAngleBrackets = false;
            } else if (char != null) {
                email.push(char);
            }
        } else if (char === "," || char === ";") {
            addAddress();
        } else if (char === '"') {
            inQuote = true;
        } else if (char === "<") {
            inAngleBrackets = true;
        } else if (char != null) {
            nameOrEmail.push(char);
        }
    }

    addAddress();

    return result;
}
