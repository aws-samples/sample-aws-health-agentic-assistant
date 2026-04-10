#!/bin/bash
set -e

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
VENV_DIR="$REPO_DIR/venv"

echo "Installing Chaplin Health MCP Server (local)..."

# Create venv if needed
if [ ! -d "$VENV_DIR" ]; then
  python3 -m venv "$VENV_DIR"
fi
echo "Installing dependencies (this may take a couple minutes on first run)..."
"$VENV_DIR/bin/pip" install --progress-bar on -r "$REPO_DIR/requirements.txt"

# Configure MCP for Kiro CLI
MCP_CONFIG="$HOME/.kiro/settings/mcp.json"
mkdir -p "$(dirname "$MCP_CONFIG")"

if [ -f "$MCP_CONFIG" ]; then
  python3 -c "
import json
with open('$MCP_CONFIG') as f:
    cfg = json.load(f)
cfg.setdefault('mcpServers', {})['chaplin-health'] = {
    'command': '$VENV_DIR/bin/python3',
    'args': ['$REPO_DIR/mcp_server.py'],
    'env': {'FASTMCP_LOG_LEVEL': 'ERROR'}
}
with open('$MCP_CONFIG', 'w') as f:
    json.dump(cfg, f, indent=2)
"
else
  cat > "$MCP_CONFIG" << EOFMCP
{
  "mcpServers": {
    "chaplin-health": {
      "command": "$VENV_DIR/bin/python3",
      "args": ["$REPO_DIR/mcp_server.py"],
      "env": {
        "FASTMCP_LOG_LEVEL": "ERROR"
      }
    }
  }
}
EOFMCP
fi

echo ""
echo "Done! Chaplin Health MCP server configured."
echo ""
echo "Next steps:"
echo "  1. Ensure AWS credentials are configured (aws configure)"
echo "  2. Restart kiro-cli to load the MCP server"
echo "  3. Run /mcp to verify chaplin-health is listed"
echo "  4. Try: 'Show me upcoming critical events in the next 30 days'"
