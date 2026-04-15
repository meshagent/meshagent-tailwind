## [0.37.2]
- Stability

## [0.37.1]
- Added `useAuth` to the React auth package to handle OAuth redirect/callback, token refresh, and profile loading without React Query, plus a `useEnsureLogin` compatibility wrapper.
- React auth `useMAuthResponse` now deduplicates token exchanges per callback parameters to avoid repeated exchanges on re-renders.
- Breaking: React auth no longer exports React Query `QueryClient` or `QueryClientProvider`.
- Breaking: `useLoginScope` now delegates to `useAuth` and defaults the OAuth scope to `email`.
- Breaking: the `staticAuthorization` helper was removed from the React room connection utilities.
- React dev terminal hooks now return `RefObject`-typed `containerRef` values for stronger typing.
- Meshagent TS client now normalizes binary request bodies for fetch and includes TypeScript declarations for runtime entrypoint functions.

## [0.37.0]
- Breaking: Database client now supports `json`, `uuid`, `list`, and `struct` types with typed wrappers (DatabaseJson/DatabaseStruct/DatabaseExpression/DatabaseDate/DatabaseUuid); list/struct values must be wrapped and update now takes `values` only.
- Breaking: Containers build now streams build contexts (start/data chunks) with `mountPath`/`chunks` and removes `start_build`.
- Breaking: Toolkit/hosting refactor replaces RemoteToolkit with startHostedToolkit/HostedToolkit, removes ToolkitConfiguration and `supports_context`, and updates React/Tailwind helpers to start hosted toolkits.
- Participant tokens now include LLM grants and richer grant serialization (including allowed toolkits and extra payload preservation), and schema helpers add `json`/`uuid` data types.
- The JS SDK now exports its version constant for client-side visibility.

## [0.36.3]
- Storage client now supports move operations and emits file moved events.
- Secrets client now supports existence checks.
- Project user add calls now omit permission fields unless explicitly set.
- Updated JS toolchain dependencies: esbuild 0.28.0, jest 30.3.0, mocha 12.0.0-beta-9.2, @tailwindcss/vite 4.2.2, @vitejs/plugin-react 6.0.1, vite 8.0.7.

## [0.36.2]
- Breaking: Removed share-connect API from the TypeScript client (`connectShare` / RoomShareConnectionInfo).
- OAuth helpers now default requested scope to `profile` (TS auth + React auth).

## [0.36.1]
- Stability

## [0.36.0]
- Added container config mounts and agent email/heartbeat settings with typed prompt content (text/file) to TypeScript service specs.
- Breaking: container API key provisioning was removed from container specs.

## [0.35.8]
- `ensureLogin` now uses the current page as the OAuth callback (no stored marker/URL), strips OAuth query params on return, and refreshes the current user profile when already logged in.
- JavaScript/TypeScript storage download examples now use storage upload and decode bytes, and the docs example build ignores generated JS artifacts alongside TypeScript sources.

## [0.35.7]
- Added container build lifecycle and image management in the TS SDK (start/build returning build IDs, list/cancel/delete builds, build logs, load/save/push/delete images) plus exec stderr streams and stricter status decoding.
- Breaking: container build APIs now return build IDs and `stop` defaults to non-forced.
- Added database namespace support and new operations (count, inspect, restore/checkout, listVersions with metadata) plus typed indexes and search offset.
- Added secrets client overhaul: OAuth/secret request handlers, offline OAuth tokens, request/provide/reject secret flows, and flexible get/set secret by id/type/name.
- Added storage enhancements: `stat`, upload MIME inference, storage entries include created/updated timestamps, and file updated/deleted events now include participant IDs.
- Breaking: messaging stream APIs removed; messaging now uses queued sends with start/stop, and RoomClient starts messaging automatically.

## [0.35.6]
- New `@meshagent/meshagent-ts-auth` package provides framework-agnostic OAuth/PKCE login, token storage/refresh, and access-token providers.
- New `@meshagent/meshagent-react-dev` package adds developer console hooks for logs, terminal sessions, and webterm/ghostty integrations.
- Breaking: `@meshagent/meshagent-react-auth` now builds on `@meshagent/meshagent-ts-auth` and React Query; built-in auth primitives and the LoginScope component were removed in favor of hook-based APIs.
- TypeScript storage uploads now honor server-provided `chunk_size` pull headers for adaptive chunking.
- Async-iterable subscriptions in the React package now call iterator `return()` on unsubscribe to clean up resources.
- Dependency updates: `react`/`react-dom` ^19.1.8, `@tanstack/react-query`/`@tanstack/react-query-devtools` ^5.95.2, `ghostty-web` ^0.4.0, `wasm-webterm` (GitHub), `jest` ^30.3.0, `@types/jest` ^30.0.0, `ts-jest` ^29.4.6, `esbuild` ^0.25.0, `@types/react` ^19.1.8, `@types/react-dom` ^19.1.8.

## [0.35.5]
- Stability

## [0.35.4]
- Stability

## [0.35.3]
- Stability

## [0.35.2]
- Stability

## [0.35.1]
- Stability

## [0.35.0]
- TypeScript client adds managed secret models with project/room CRUD using base64 payloads, plus external OAuth registration CRUD for project and room scopes; legacy secret helpers now resolve managed secret data.
- Memory client expanded with typed entities/relationships/datasets and operations for inspect/query/upsert/ingest/recall/delete/optimize, including decoding of row-encoded results and binary values.
- Base64 helpers now work across Node and browser runtimes for secret and memory payloads.

## [0.34.0]
- Stability

## [0.33.3]
- Stability

## [0.33.2]
- Stability

## [0.33.1]
- Stability

## [0.33.0]
- Stability

## [0.32.0]
- Stability

## [0.31.4]
- Stability

## [0.31.3]
- Stability

## [0.31.2]
- Stability

## [0.31.1]
- Stability

## [0.31.0]
- Stability

## [0.30.1]
- Stability

## [0.30.0]
- Breaking: tool invocation now uses toolkit-based `room.invoke`/`room.*` events with streaming tool-call chunks, and `RemoteToolkit` registration follows the new room-scoped protocol.
- Added a Containers client with image listing/pulling, container lifecycle operations, and exec/log streaming.
- Storage client replaced handle-based writes with streaming upload/download, download URLs, and size metadata.
- Database and Sync clients now stream inserts/queries/search and sync updates with typed value handling; messaging/queues/developer clients updated to toolkit invocation.

## [0.29.4]
- Stability

## [0.29.3]
- Stability

## [0.29.2]
- Stability

## [0.29.1]
- Stability

## [0.29.0]
- Stability

## [0.28.16]
- Stability

## [0.28.15]
- Stability

## [0.28.14]
- Stability

## [0.28.13]
- Stability

## [0.28.12]
- Stability

## [0.28.11]
- Stability

## [0.28.10]
- Stability

## [0.28.9]
- Stability

## [0.28.8]
- Stability

## [0.28.7]
- Stability

## [0.28.6]
- Stability

## [0.28.5]
- Stability

## [0.28.4]
- Stability

## [0.28.3]
- Stability

## [0.28.2]
- Stability

## [0.28.1]
- Stability

## [0.28.0]
- BREAKING: AgentChatContext and TaskContext were removed from the TypeScript agent API, and RemoteTaskRunner.ask now accepts only argument payloads.

## [0.27.2]
- Stability

## [0.27.1]
- Stability

## [0.27.0]
- No Node.js/TypeScript source changes were introduced in this range; updates are dependency-focused.
- Updated third-party Node dev dependency `mocha` from `^11.1.0` to `^11.3.0` across SDK packages.
- Updated npm lockfile dependency resolution, including `yjs` to `13.6.29` and aligned Mocha transitives (`diff`, `minimatch`, `workerpool`).

## [0.26.0]
- Stability

## [0.25.9]
- Stability

## [0.25.8]
- Stability

## [0.25.7]
- Stability

## [0.25.6]
- Stability

## [0.25.5]
- Stability

## [0.25.4]
- Stability

## [0.25.3]
- Stability

## [0.25.2]
- Stability

## [0.25.1]
- Stability

## [0.25.0]
- Added SQL query support with TableRef and typed params in the database client.
- Added a SecretsClient on RoomClient (set/get/list/delete, including `for_identity` support).
- Exported the secrets client from the package entrypoint.

## [0.24.5]
- Stability

## [0.24.4]
- Stability

## [0.24.3]
- Stability

## [0.24.2]
- Stability

## [0.24.1]
- Stability

## [0.24.0]
- Breaking: removed `AgentsClient.ask` and `listAgents` from the TypeScript SDK.
- Breaking: renamed `AgentCallContext` to `TaskContext` and removed RemoteTaskRunner agent ask handler registration.

## [0.23.0]
- Stability

## [0.22.2]
- Stability

## [0.22.1]
- Stability

## [0.22.0]
- JS/TS entrypoints now use base-64 encode/decode helpers instead of browser btoa/atob for Node compatibility.

## [0.21.0]
- Stability

## [0.20.6]
- Stability

## [0.20.5]
- Stability

## [0.20.4]
- Stability

## [0.20.3]
- Stability

## [0.20.2]
- Stability

## [0.20.1]
- Stability

## [0.20.0]
- Breaking: mailbox create/update APIs now require an `isPublic` parameter and send it as `public` in requests

## [0.19.5]
- Stability

## [0.19.4]
- Stability

## [0.19.3]
- Stability

## [0.19.2]
- Add boolean data type support in TypeScript schema types.

## [0.19.1]
- Stability

## [0.19.0]
- Stability

## [0.18.2]
- Stability

## [0.18.1]
- Stability

## [0.18.0]
- yjs dependency updated from `^13.6.28` to `^13.6.29`
- Updated Yjs transaction cleanup behavior to reduce noisy logging and improve cleanup sequencing

## [0.17.1]
- Stability

## [0.17.0]
- Updated `yjs` dependency from `^13.6.7` to `^13.6.28`
- Prevented “maximum call stack size exceeded” when encoding large document state/state vectors by switching to chunked base64 conversion in the entrypoint
- Breaking: removed `AgentDescription.requires` from the TypeScript agent client model/serialization
- Updated the Dart/Flutter entrypoint build target to output the bundled JS into the Flutter package

## [0.16.0]
- Stability

## [0.15.0]
- Updated the bundled Luau WASM JavaScript bindings to support per-script environments (`envIndex`) and expose additional Lua operations (metatable/fenv and stack removal).

## [0.14.0]
- Breaking change: updated Luau WASM JS bindings, including renaming the script load/compile export (`_riveLuaCompileAndRegisterScript` → `__luau_load`) and adjusting its signature

## [0.13.0]
- Updated the Luau WebAssembly JavaScript bindings to expose additional Lua table operations (create/set/get), aligning web runtime behavior with native/FFI capabilities

## [0.12.0]
- Expose Luau buffer APIs in the web WASM JavaScript bindings (newbuffer, buffer length, copy-in/copy-out, and primitive read/write helpers) to enable binary data transfer

## [0.11.0]
- Stability

## [0.10.1]
- Stability

## [0.10.0]
- Stability

## [0.9.3]
- Stability

## [0.9.2]
- Stability

## [0.9.1]
- Stability

## [0.9.0]
- Stability

## [0.8.4]
- Stability

## [0.8.3]
- Stability

## [0.8.2]
- Stability

## [0.8.1]
- Stability

## [0.8.0]
- Stability

## [0.7.1]
- Stability
