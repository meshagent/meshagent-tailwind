#!/bin/bash

export MESHAGENT_API_URL=http://localhost:8080

export MESHAGENT_SECRET=testsecret
export MESHAGENT_PROJECT_ID=testproject
export MESHAGENT_KEY_ID=testkey

PWD=`pwd`
export MESHAGENT_SERVER_CLI_FILES_STORAGE_PATH="$PWD/data"

export VIRTUAL_ENV="$PWD/venv"
source $VIRTUAL_ENV/bin/activate

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cargo run --manifest-path "$REPO_ROOT/rust/Cargo.toml" -p room-server-cli
