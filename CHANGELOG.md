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
