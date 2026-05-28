import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
    resolve: {
        alias: {
            "@meshagent/meshagent": resolve(__dirname, "../meshagent-ts/src/index.ts"),
            "@meshagent/meshagent-agents": resolve(__dirname, "../meshagent-agents-ts/src/index.ts"),
            "@meshagent/meshagent-react": resolve(__dirname, "../meshagent-react/src/index.ts"),
        },
    },
    test: {
        environment: "jsdom",
        globals: true,
        setupFiles: ["./src/test/setup.ts"],
    },
});
