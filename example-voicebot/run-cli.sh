#!/bin/bash

export MESHAGENT_API_URL=http://localhost:8080

export MESHAGENT_SECRET=testsecret
export MESHAGENT_PROJECT_ID=testproject
export MESHAGENT_KEY_ID=testkey

PWD=`pwd`
export MESHAGENT_SERVER_CLI_FILES_STORAGE_PATH="$PWD/data"

export VIRTUAL_ENV="$PWD/venv"
source $VIRTUAL_ENV/bin/activate

python3 ../../../meshagent-server/meshagent/server/cli/cli.py
