#!/bin/sh
SERVER="mcp_server"

if pgrep -f "python3.*$SERVER" > /dev/null; then
    echo -n "chaplin-health-mcp-server is running"
    exit 0
fi

exit 1
