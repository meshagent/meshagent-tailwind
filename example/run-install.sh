#!/bin/bash
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

