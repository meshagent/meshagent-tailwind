#!/bin/bash -eu

# This script generates 4 builds, as follows:
# - dist/esm: ESM build for Node.js
# - dist/esm-browser: ESM build for the Browser
# - dist/cjs: CommonJS build for Node.js
# - dist/cjs-browser: CommonJS build for the Browser
#
# Note: that the "preferred" build for testing (local and CI) is the ESM build,
# except where we specifically test the other builds

set -e # exit on error

# Change to project root
ROOT=`pwd`

cd "$ROOT/../meshagent-entrypoint"
npm run build-ts

cd "$ROOT" || exit 1
DIST_DIR="$ROOT/dist"

find $DIST_DIR -type f -delete

# Build each module type
for target in esm node browser
do
    echo "Building ${target}"

    tsc -p tsconfig.${target}.json
done

cd "$ROOT/../meshagent-entrypoint"
npm run build-ts-browser
