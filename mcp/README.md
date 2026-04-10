# Chaplin Health Events MCP Server

MCP server for AWS Health Event analysis — AI-powered diagnostics, critical event tracking, and proactive health intelligence across your AWS accounts.

> **Powered by [Chaplin](../README.md)** — an agentic AI platform that transforms how organizations understand and respond to AWS health events through natural language queries and real-time analysis.

## Features

### Health Event Intelligence
* **Event category breakdown**: Issue, Account Notification, Scheduled Change, Investigation — with event and service counts
* **Event type classification**: Configuration Alerts, Cost Impact Events, Maintenance Updates, Migration Requirements, Operational Notifications, Security Compliance
* **Critical event tracking**: Upcoming events in 30-day and 30–60 day windows, plus past due events (120 days)
* **Drill-down details**: Filter events by service, category, status, region, account, event type, or ARN

### AI-Powered Analysis
* **Natural language queries**: Ask questions about your health events in plain English
* **Agentic diagnostics**: Same Strands Agent + Bedrock Claude pipeline that powers the Chaplin web dashboard
* **Contextual insights**: Impact analysis combining event data with account metadata

### Dashboard Parity
Every feature on the Chaplin web dashboard is available as an MCP tool — no browser required.

## Prerequisites

1. **AWS Account** with appropriate permissions
2. **AWS CLI** configured with credentials
3. **Amazon Bedrock**: Access to Claude Sonnet 4 in `us-east-1`
4. **DynamoDB**: `chaplin-health-events` table populated with health event data (see [Chaplin setup](../README.md))
5. **Python**: 3.10 or higher

## Installation

| Kiro | Cursor | VS Code |
|------|--------|---------|
| [<img src="https://img.shields.io/badge/Add_to_Kiro-blue?logo=data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cGF0aCBkPSJNMTIgMkM2LjQ4IDIgMiA2LjQ4IDIgMTJzNC40OCAxMCAxMCAxMCAxMC00LjQ4IDEwLTEwUzE3LjUyIDIgMTIgMnptMCAxOGMtNC40MSAwLTgtMy41OS04LThzMy41OS04IDgtOCA4IDMuNTkgOCA4LTMuNTkgOC04IDh6IiBmaWxsPSJ3aGl0ZSIvPjwvc3ZnPg==" alt="Add to Kiro">](https://kiro.dev/launch/mcp/add?name=chaplin-health-mcp-server&config=%7B%22command%22%3A%20%22python3%22%2C%20%22args%22%3A%20%5B%22-m%22%2C%20%22mcp_server%22%5D%2C%20%22env%22%3A%20%7B%22FASTMCP_LOG_LEVEL%22%3A%20%22ERROR%22%2C%20%22AWS_REGION%22%3A%20%22us-east-1%22%7D%7D) | [<img src="https://img.shields.io/badge/Install_MCP_Server-purple?logo=data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cGF0aCBkPSJNMTIgMkM2LjQ4IDIgMiA2LjQ4IDIgMTJzNC40OCAxMCAxMCAxMCAxMC00LjQ4IDEwLTEwUzE3LjUyIDIgMTIgMnptMCAxOGMtNC40MSAwLTgtMy41OS04LThzMy41OS04IDgtOCA4IDMuNTkgOCA4LTMuNTkgOC04IDh6IiBmaWxsPSJ3aGl0ZSIvPjwvc3ZnPg==" alt="Install MCP Server">](https://cursor.com/en/install-mcp?name=chaplin-health-mcp-server&config=ewogICAgImNvbW1hbmQiOiAicHl0aG9uMyAtbSBtY3Bfc2VydmVyIiwKICAgICJlbnYiOiB7CiAgICAgICAgIkZBU1RNQ1BfTE9HX0xFVkVMIjogIkVSUk9SIiwKICAgICAgICAiQVdTX1JFR0lPTiI6ICJ1cy1lYXN0LTEiCiAgICB9LAogICAgImRpc2FibGVkIjogZmFsc2UsCiAgICAiYXV0b0FwcHJvdmUiOiBbXQp9) | [<img src="https://img.shields.io/badge/Install_on_VS_Code-green?logo=visualstudiocode" alt="Install on VS Code">](https://insiders.vscode.dev/redirect/mcp/install?name=Chaplin%20Health%20MCP%20Server&config=%7B%22command%22%3A%20%22python3%22%2C%20%22args%22%3A%20%5B%22-m%22%2C%20%22mcp_server%22%5D%2C%20%22env%22%3A%20%7B%22FASTMCP_LOG_LEVEL%22%3A%20%22ERROR%22%2C%20%22AWS_REGION%22%3A%20%22us-east-1%22%7D%2C%20%22disabled%22%3A%20false%2C%20%22autoApprove%22%3A%20%5B%5D%7D) |

### ⚡ Quick Install (script)

```bash
cd mcp/
chmod +x install.sh
./install.sh
```

This creates a virtual environment, installs dependencies, and configures the MCP server in `~/.kiro/settings/mcp.json`.

### 🐳 Using Docker

Build the image from the repo root:

```bash
docker build -t chaplin-health-mcp-server -f mcp/Dockerfile .
```

Configure your MCP client:

```json
{
  "mcpServers": {
    "chaplin-health": {
      "command": "docker",
      "args": [
        "run",
        "--rm",
        "--interactive",
        "-v", "~/.aws:/home/app/.aws:ro",
        "--env", "FASTMCP_LOG_LEVEL=ERROR",
        "--env", "AWS_REGION=us-east-1",
        "--env", "AWS_PROFILE=default",
        "chaplin-health-mcp-server:latest"
      ],
      "env": {},
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

> **Note**: The container mounts `~/.aws` as read-only for credentials. Change `AWS_PROFILE` to use a different profile.

### 🔧 Manual Configuration

Add to `~/.kiro/settings/mcp.json` (Kiro CLI) or your MCP client's config:

**For Linux/macOS:**

```json
{
  "mcpServers": {
    "chaplin-health": {
      "command": "/path/to/mcp/venv/bin/python3",
      "args": ["/path/to/mcp/mcp_server.py"],
      "env": {
        "FASTMCP_LOG_LEVEL": "ERROR",
        "AWS_REGION": "us-east-1"
      }
    }
  }
}
```

## Tools

### Overview & Summary (instant, no LLM cost)

| Tool | Description |
|------|-------------|
| `get_health_summary` | High-level counts by service, status, category, region |
| `get_critical_events_count` | Count of critical events in the next 30 days |
| `get_event_categories` | Event Categories — Issue, Account Notification, Scheduled Change, Investigation |
| `get_event_type_stats` | Event Types — Configuration Alerts, Cost Impact, Maintenance, Migration, Operational, Security |

### Detail Views (instant, no LLM cost)

| Tool | Description |
|------|-------------|
| `get_event_category_details(category_id)` | Events for a specific category (e.g. `issue`, `accountNotification`) |
| `get_event_type_details(event_type_id)` | Events for a specific type (e.g. `migration-requirements`, `security-compliance`) |
| `get_drill_down_details(...)` | Filter events by service, category, status, region, account, event_type, arn |
| `get_cached_prompts` | Previously used prompts with usage counts (Suggested Prompts sidebar) |

### AI Agent Analysis (30–60s, uses Bedrock Claude)

| Tool | Description |
|------|-------------|
| `analyze_health_events(prompt)` | Free-form natural language analysis — same as AI Agents Diagnostics UI |
| `get_critical_events_30d` | Upcoming critical events in next 30 days — same as dashboard red card |
| `get_critical_events_60d` | Upcoming critical events in 30–60 day window |
| `get_past_due_events` | Past due events (120 days) still open/upcoming |

## Example Prompts

```
# Quick data (instant)
Give me a summary of all health events
Show me the event categories breakdown
What are the event type stats?

# AI analysis (30-60s)
What Bedrock models are going end of life?
Give me open Lambda events and highlight critical ones
Can you check upcoming events for RDS?
Show me critical events in the next 30 days
Which accounts have the most open health events?
```

## AWS Authentication

The MCP server requires AWS credentials with the following permissions:

- `dynamodb:Scan`, `dynamodb:Query`, `dynamodb:DescribeTable` on `chaplin-health-events` table
- `bedrock:InvokeModel` for Claude Sonnet 4 in `us-east-1` (required for AI analysis tools only)

### Configuration

| Environment Variable | Description | Default |
|---------------------|-------------|---------|
| `AWS_REGION` | AWS region for DynamoDB and Bedrock | `us-east-1` |
| `AWS_PROFILE` | AWS profile from `~/.aws/credentials` | default |
| `FASTMCP_LOG_LEVEL` | MCP server log level | `ERROR` |

## Architecture

```
MCP Client (Kiro/Cursor/VS Code)
    │
    ▼ (JSON-RPC over stdio)
┌─────────────────────────────┐
│   mcp_server.py (FastMCP)   │
│                             │
│  Summary tools ──► DynamoDB │  (instant, no LLM)
│                             │
│  AI tools ──► Strands Agent │  (30-60s, Bedrock Claude)
│              ──► DynamoDB   │
│              ──► Bedrock    │
└─────────────────────────────┘
```

The MCP server reuses the same agent pipeline as the Chaplin web dashboard — `agentic_analysis_simple.py` → `DBQueryBuilder.py` → DynamoDB + Bedrock Claude. Results are identical.
