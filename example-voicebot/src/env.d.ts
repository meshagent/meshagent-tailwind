
/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_MESHAGENT_KEY_ID: string;
    readonly VITE_MESHAGENT_PROJECT_ID: string;
    readonly VITE_MESHAGENT_SECRET: string;
    readonly VITE_MESHAGENT_API_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
