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
