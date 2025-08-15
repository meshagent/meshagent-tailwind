#!/bin/bash
export MESHAGENT_API_URL=http://localhost:8080

export MESHAGENT_SECRET=testsecret
export MESHAGENT_PROJECT_ID=testproject
export MESHAGENT_KEY_ID=testkey

PWD=`pwd`
export MESHAGENT_SERVER_CLI_FILES_STORAGE_PATH="$PWD/data"

VIRTUAL_ENV="$PWD/venv"

python3 -m venv $VIRTUAL_ENV
source $VIRTUAL_ENV/bin/activate

pip3 install uv
uv pip install --no-cache-dir \
    playwright \
    ../../meshagent-api \
    ../../meshagent-agents \
    ../../meshagent-tools \
    ../../meshagent-openai \
    ../../meshagent-otel \
    ../../../meshagent-cloud \
    ../../../meshagent-server 


python3 ../../../meshagent-server/meshagent/server/cli/cli.py &
CLI_PID=$!

npm i
npm run build
python3 -m http.server 8081 -d dist &
SERVER_PID=$!

cleanup() {
    echo "Cleaning up..."

    kill $CLI_PID 2>/dev/null || true
    kill $SERVER_PID 2>/dev/null || true
}

echo "Starting MeshAgent CLI server..."

# When this script exits (for any reason), kill the background job
# trap cleanup EXIT

# npm run build && npx mocha dist/node/test/*.js
