#!/usr/bin/env python3
"""
Chaplin Health Events MCP Server — Exposes AWS Health event analysis tools
for AI agents via Model Context Protocol. Mirrors all dashboard APIs.
"""
import sys
import os
import re
import json
import logging
from typing import Optional
from datetime import datetime, timedelta
from collections import Counter
from mcp.server.fastmcp import FastMCP

# Agents are bundled in the package
PKG_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(PKG_DIR, "agents"))

os.environ["BYPASS_TOOL_CONSENT"] = "true"

import boto3

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

from mcp.server.fastmcp.server import TransportSecuritySettings

mcp = FastMCP("Chaplin Health Events",
              dependencies=["boto3", "strands-agents"],
              transport_security=TransportSecuritySettings(enable_dns_rebinding_protection=False))

# --- Shared DynamoDB setup ---

TABLE_NAME = "chaplin-health-events"
OUTPUT_DIR = os.path.join(os.path.expanduser("~"), ".chaplin", "output")


def _get_region():
    region = os.getenv("AWS_REGION_OVERRIDE") or os.getenv("AWS_REGION")
    if region:
        return region
    return "us-east-1"


_region = _get_region()
_dynamodb = boto3.resource("dynamodb", region_name=_region)
_table = _dynamodb.Table(TABLE_NAME)


def _scan_all(filter_expr=None, expr_names=None, expr_values=None, projection=None):
    """Full paginated scan with optional filter."""
    kwargs = {}
    if filter_expr:
        kwargs["FilterExpression"] = filter_expr
    if expr_names:
        kwargs["ExpressionAttributeNames"] = expr_names
    if expr_values:
        kwargs["ExpressionAttributeValues"] = expr_values
    if projection:
        kwargs["ProjectionExpression"] = projection

    items = []
    resp = _table.scan(**kwargs)
    items.extend(resp.get("Items", []))
    while "LastEvaluatedKey" in resp:
        kwargs["ExclusiveStartKey"] = resp["LastEvaluatedKey"]
        resp = _table.scan(**kwargs)
        items.extend(resp.get("Items", []))
    return items


def _breakdown(items, field):
    counts = Counter(r.get(field) or "Unknown" for r in items)
    return dict(counts.most_common())


def _summarize_event(e):
    """Extract key fields from an event for concise output (avoids context overflow)."""
    summary = e.get("__summary") or {}
    return {
        "service": e.get("service", "N/A"),
        "event_type": e.get("event_type", "N/A"),
        "eventCategory": e.get("eventCategory", "N/A"),
        "status_code": e.get("status_code", "N/A"),
        "region": e.get("region", "N/A"),
        "account_id": e.get("account_id") or e.get("account", "N/A"),
        "start_time": e.get("start_time", "N/A"),
        "end_time": e.get("end_time", "N/A"),
        "title": summary.get("title") or e.get("eventCategory") or "N/A",
        "event": (summary.get("schedule") or [{}])[0].get("event") or e.get("event_type") or "N/A",
        "risk": summary.get("risk", "N/A"),
    }


# --- Event Type classification patterns (mirrors server.js exactly) ---

EVENT_TYPE_PATTERNS = {
    "configuration-alerts": [
        r".*_HIGH_RISK_CONFIG.*", r".*_PERSISTENCE_EXPIRING$",
        r".*_RENEWAL_STATE_CHANGE$", r".*_CUSTOMER_ENGAGEMENT$",
        r".*_RUNAWAY_TERMINATION.*",
    ],
    "cost-impact-events": [
        r"AWS_BILLING_NOTIFICATION$", r".*_ODCR_.*",
        r".*_SUBSCRIPTION_RENEWAL.*", r".*_CAPACITY_.*",
        r".*_UNDERUTILIZATION.*",
    ],
    "maintenance-updates": [
        r".*_MAINTENANCE_SCHEDULED$", r".*_MAINTENANCE_COMPLETE$",
        r".*_MAINTENANCE_EXTENSION$", r".*_UPDATE_AVAILABLE$",
        r".*_UPDATE_COMPLETED$", r".*_AUTO_UPGRADE_NOTIFICATION$",
        r".*_UPCOMING_MAINTENANCE$",
    ],
    "migration-requirements": [
        r".*_PLANNED_LIFECYCLE_EVENT$",
        r".*_PERSISTENT_INSTANCE_RETIREMENT_SCHEDULED$",
        r".*_TASK_PATCHING_RETIREMENT$", r".*_VM_DEPRECATED$",
    ],
    "operational-notifications": [
        r".*_OPERATIONAL_NOTIFICATION$", r".*_OPERATIONAL_ISSUE$",
        r".*_SERVICE_ISSUE$", r".*_CLUSTER_HEALTH_ISSUES$",
        r".*_POD_EVICTIONS$", r".*_REDUNDANCY_LOSS$",
        r".*_TUNNEL_NOTIFICATION$", r".*_EXPERIMENT_EVENT$",
    ],
    "security-compliance": [
        r".*_SECURITY_NOTIFICATION$", r".*_SECURITY_PATCHING_EVENT$",
    ],
}

EVENT_TYPE_META = {
    "configuration-alerts": {"name": "Configuration Alerts", "description": "Configuration issues, expiring resources"},
    "cost-impact-events": {"name": "Cost Impact Events", "description": "Billing changes, capacity reservations, cost impacts"},
    "maintenance-updates": {"name": "Maintenance Updates", "description": "Scheduled maintenance, automatic updates"},
    "migration-requirements": {"name": "Migration Requirements", "description": "Platform migrations, version upgrades, instance retirements"},
    "operational-notifications": {"name": "Operational Notifications", "description": "Service issues, operational alerts"},
    "security-compliance": {"name": "Security Compliance", "description": "Security patches, vulnerability notifications"},
}


# ============================================================
# 1. OVERVIEW / SUMMARY TOOLS (lightweight, no LLM)
# ============================================================

@mcp.tool()
async def get_health_summary() -> str:
    """
    Get a high-level summary of all AWS health events — counts by service,
    status, event category, and region. No raw event data returned.
    Same as the dashboard overview numbers.
    """
    events = _scan_all(projection="service, status_code, eventCategory, #r, event_type",
                       expr_names={"#r": "region"})

    open_events = [e for e in events if e.get("status_code") == "open"]
    upcoming = [e for e in events if e.get("status_code") == "upcoming"]

    return json.dumps({
        "total_events": len(events),
        "open_count": len(open_events),
        "upcoming_count": len(upcoming),
        "by_status": _breakdown(events, "status_code"),
        "by_service": _breakdown(events, "service"),
        "by_event_category": _breakdown(events, "eventCategory"),
        "by_region": _breakdown(events, "region"),
    }, indent=2, default=str)


@mcp.tool()
async def get_critical_events_count() -> str:
    """
    Get the count of critical events in the next 30 days.
    Same as the badge count on the dashboard Critical Events section.
    """
    now = datetime.now().isoformat()
    thirty = (datetime.now() + timedelta(days=30)).isoformat()

    events = _scan_critical(now, thirty)
    return json.dumps({"critical_events_count_next_30d": len(events)})


# ============================================================
# 2. EVENT CATEGORIES (Issue, Account Notification, etc.)
# ============================================================

@mcp.tool()
async def get_event_categories() -> str:
    """
    Get event category breakdown — Issue, Account Notification, Scheduled Change,
    Investigation — with event counts and unique service counts per category.
    Same as the 'Event Categories' cards on the dashboard.
    """
    events = _scan_all(projection="eventCategory, service")

    categories = {
        "issue": {"name": "Issue", "desc": "Service issues and outages", "count": 0, "services": set()},
        "accountNotification": {"name": "Account Notification", "desc": "Account-specific notifications", "count": 0, "services": set()},
        "scheduledChange": {"name": "Scheduled Change", "desc": "Planned maintenance and changes", "count": 0, "services": set()},
        "investigation": {"name": "Investigation", "desc": "AWS investigations", "count": 0, "services": set()},
    }

    for e in events:
        cat = e.get("eventCategory")
        if cat in categories:
            categories[cat]["count"] += 1
            if e.get("service"):
                categories[cat]["services"].add(e["service"])

    result = [{"id": k, "name": v["name"], "description": v["desc"],
               "eventCount": v["count"], "serviceCount": len(v["services"])}
              for k, v in categories.items()]

    return json.dumps({"data": result, "lastRefreshed": datetime.now().isoformat()}, indent=2)


@mcp.tool()
async def get_event_category_details(category_id: str) -> str:
    """
    Get detailed events for a specific event category.
    Same as clicking an Event Category card on the dashboard (e.g. Issue, Account Notification).
    Returns summarized event records (not full blobs) to avoid context overflow.

    Args:
        category_id: One of: issue, accountNotification, scheduledChange, investigation
    """
    valid = ["issue", "accountNotification", "scheduledChange", "investigation"]
    if category_id not in valid:
        return json.dumps({"error": f"Unknown category_id. Valid: {valid}"})

    events = _scan_all(
        filter_expr="eventCategory = :cat",
        expr_values={":cat": category_id},
    )

    # Group by service for summary, return summarized events
    by_service = _breakdown(events, "service")
    by_status = _breakdown(events, "status_code")
    summarized = [_summarize_event(e) for e in events]
    # Sort by start_time desc
    summarized.sort(key=lambda x: x.get("start_time", ""), reverse=True)

    return json.dumps({
        "category": category_id,
        "count": len(events),
        "by_service": by_service,
        "by_status": by_status,
        "events": summarized[:100],  # cap at 100 to avoid context overflow
        "total_events": len(events),
        "truncated": len(events) > 100,
    }, indent=2, default=str)


# ============================================================
# 3. EVENT TYPES (Config Alerts, Maintenance, Migration, etc.)
# ============================================================

@mcp.tool()
async def get_event_type_stats() -> str:
    """
    Get event type breakdown — Configuration Alerts, Cost Impact Events,
    Maintenance Updates, Migration Requirements, Operational Notifications,
    Security Compliance — with event counts and service counts.
    Same as the 'Event Type' cards on the dashboard.
    """
    events = _scan_all(projection="event_type, service")

    stats = {cat: {"count": 0, "services": set()} for cat in EVENT_TYPE_PATTERNS}

    for e in events:
        et = e.get("event_type", "")
        for cat, patterns in EVENT_TYPE_PATTERNS.items():
            if any(re.match(p, et) for p in patterns):
                stats[cat]["count"] += 1
                if e.get("service"):
                    stats[cat]["services"].add(e["service"])
                break

    result = {}
    for cat, info in stats.items():
        meta = EVENT_TYPE_META[cat]
        result[cat] = {"name": meta["name"], "description": meta["description"],
                       "eventCount": info["count"], "serviceCount": len(info["services"])}

    return json.dumps({"data": result, "lastRefreshed": datetime.now().isoformat()}, indent=2)


@mcp.tool()
async def get_event_type_details(event_type_id: str) -> str:
    """
    Get detailed events for a specific event type category.
    Same as clicking an Event Type card on the dashboard.
    Returns summarized event records to avoid context overflow.

    Args:
        event_type_id: One of: configuration-alerts, cost-impact-events,
                       maintenance-updates, migration-requirements,
                       operational-notifications, security-compliance
    """
    patterns = EVENT_TYPE_PATTERNS.get(event_type_id)
    if not patterns:
        return json.dumps({"error": f"Unknown event_type_id. Valid: {list(EVENT_TYPE_PATTERNS.keys())}"})

    events = _scan_all()
    compiled = [re.compile(p) for p in patterns]
    filtered = [e for e in events if any(p.match(e.get("event_type", "")) for p in compiled)]

    by_service = _breakdown(filtered, "service")
    by_status = _breakdown(filtered, "status_code")
    summarized = [_summarize_event(e) for e in filtered]
    summarized.sort(key=lambda x: x.get("start_time", ""), reverse=True)

    return json.dumps({
        "event_type": event_type_id,
        "name": EVENT_TYPE_META[event_type_id]["name"],
        "count": len(filtered),
        "by_service": by_service,
        "by_status": by_status,
        "events": summarized[:100],
        "total_events": len(filtered),
        "truncated": len(filtered) > 100,
    }, indent=2, default=str)


# ============================================================
# 4. DRILL-DOWN (View Details from agent analysis results)
# ============================================================

@mcp.tool()
async def get_drill_down_details(
    service: Optional[str] = None,
    event_category: Optional[str] = None,
    status_code: Optional[str] = None,
    region: Optional[str] = None,
    account: Optional[str] = None,
    event_type: Optional[str] = None,
    start_time: Optional[str] = None,
    arn: Optional[str] = None,
) -> str:
    """
    Drill down into specific health events with exact-match filters.
    Same as the 'View Details' links in the dashboard agent analysis results.
    At least one filter is required.

    Args:
        service: AWS service name (e.g. "LAMBDA", "S3", "DOCDB")
        event_category: Category (e.g. "scheduledChange", "issue", "accountNotification")
        status_code: Status (e.g. "open", "upcoming", "closed")
        region: AWS region (e.g. "us-east-1", "global")
        account: AWS account ID
        event_type: Full event type string (e.g. "AWS_LAMBDA_PLANNED_LIFECYCLE_EVENT")
        start_time: Event start time
        arn: Event ARN
    """
    filters = []
    names = {}
    values = {}

    def add(field, val, placeholder, needs_name=False):
        if val:
            if needs_name:
                names[f"#{field}"] = field
                filters.append(f"#{field} = :{placeholder}")
            else:
                filters.append(f"{field} = :{placeholder}")
            values[f":{placeholder}"] = val

    add("service", service, "svc", needs_name=True)
    add("eventCategory", event_category, "cat")
    add("status_code", status_code, "st")
    add("region", region, "reg", needs_name=True)
    add("account", account, "acct", needs_name=True)
    add("event_type", event_type, "et")
    add("start_time", start_time, "stime")
    add("arn", arn, "arn")

    if not filters:
        return json.dumps({"error": "At least one filter is required"})

    events = _scan_all(
        filter_expr=" AND ".join(filters),
        expr_names=names if names else None,
        expr_values=values,
    )

    # Sort by account, service, eventCategory, start_time (same as server.js)
    events.sort(key=lambda e: (
        e.get("account", ""), e.get("service", ""),
        e.get("eventCategory", ""), e.get("start_time", "")
    ))

    summarized = [_summarize_event(e) for e in events]

    return json.dumps({
        "filters_applied": {k: v for k, v in [
            ("service", service), ("event_category", event_category),
            ("status_code", status_code), ("region", region),
            ("account", account), ("event_type", event_type),
            ("start_time", start_time), ("arn", arn),
        ] if v},
        "count": len(events),
        "events": summarized[:100],
        "total_events": len(events),
        "truncated": len(events) > 100,
    }, indent=2, default=str)


# ============================================================
# 5. CACHED PROMPTS (Suggested Prompts sidebar)
# ============================================================

@mcp.tool()
async def get_cached_prompts() -> str:
    """
    Get the list of previously used prompts with usage counts.
    Same as the 'Suggested Prompts' sidebar on the AI Agents Diagnostics page.
    """
    prompts_file = os.path.join(OUTPUT_DIR, "cached-prompts.json")
    if os.path.exists(prompts_file):
        with open(prompts_file) as f:
            data = json.load(f)
        data["prompts"].sort(key=lambda p: p.get("usage_count", 0), reverse=True)
        return json.dumps(data, indent=2)
    return json.dumps({"prompts": []})


# ============================================================
# 6. CRITICAL EVENTS (30d, 30-60d, Past Due — AI agent powered)
# ============================================================

def _run_agent(prompt: str) -> str:
    """Run the Strands agent — same as what the dashboard calls.
    Redirects stdout so Strands streaming output doesn't
    corrupt the MCP JSON-RPC transport on stdout."""
    import io
    from agentic_analysis_simple import analyze_health_events as _analyze

    old_stdout = sys.stdout
    sys.stdout = io.StringIO()  # capture/discard Strands streaming output
    try:
        result = str(_analyze(prompt))
    finally:
        sys.stdout = old_stdout
    return result


@mcp.tool()
async def analyze_health_events(prompt: str) -> str:
    """
    Run AI-powered analysis on AWS health events using natural language.
    Uses Strands Agent with Bedrock Claude to query DynamoDB and generate insights.
    Same as the 'AI Agents Diagnostics' page on the dashboard.

    Args:
        prompt: Natural language query (e.g. "What Bedrock models are going end of life?",
                "Give me open Lambda events and highlight critical ones",
                "Can you check upcoming events for RDS?")
    """
    print("⏳ Running AI analysis (this may take 30-60 seconds)...", file=sys.stderr, flush=True)
    return _run_agent(prompt)


def _scan_critical(start: str, end: str):
    """Deterministic scan: status_code IN ('upcoming','open') + date range."""
    return _scan_all(
        filter_expr="(#sc = :open OR #sc = :upcoming) AND #st BETWEEN :start AND :end",
        expr_names={"#sc": "status_code", "#st": "start_time"},
        expr_values={":open": "open", ":upcoming": "upcoming", ":start": start, ":end": end},
    )


def _analyze_events(events: list, prompt: str) -> str:
    """Build deterministic summary table, use LLM only for insights."""
    if not events:
        return "No events found matching the criteria."

    # --- Deterministic summary (never trust LLM to list events) ---
    from collections import defaultdict
    grouped = defaultdict(lambda: {"count": 0, "statuses": set(), "title": "", "event_type": ""})
    for e in events:
        svc = e.get("service", "Unknown")
        start = e.get("start_time", "Unknown")[:10]
        key = (start, svc)
        grouped[key]["count"] += 1
        grouped[key]["statuses"].add(e.get("status_code", "unknown"))
        if not grouped[key]["title"]:
            summary = e.get("__summary", {})
            if isinstance(summary, dict):
                grouped[key]["title"] = summary.get("title", {}).get("S", "") if isinstance(summary.get("title"), dict) else str(summary.get("title", ""))
            desc = e.get("description", "")
            grouped[key]["event_type"] = e.get("event_type", "")

    lines = [f"Total events: {len(events)}", ""]
    lines.append("| Date | Service | Event Type | Status | Accounts |")
    lines.append("|------|---------|-----------|--------|----------|")
    for (start, svc), info in sorted(grouped.items()):
        title = info["title"] or info["event_type"] or "N/A"
        statuses = ", ".join(sorted(info["statuses"]))
        lines.append(f"| {start} | {svc} | {title} | {statuses} | {info['count']} |")

    summary_table = "\n".join(lines)

    # --- LLM for insights only ---
    import io
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
    from strands import Agent
    from strands.models.bedrock import BedrockModel

    model = BedrockModel(
        model_id="global.anthropic.claude-sonnet-4-20250514-v1:0",
        region_name=_get_region(), temperature=0.1
    )
    agent = Agent(model=model)

    old_stdout = sys.stdout
    sys.stdout = io.StringIO()
    try:
        insights = str(agent(
            f"Given these AWS health events:\n\n{summary_table}\n\n"
            f"Context: {prompt}\n\n"
            "Provide ONLY: 1) Top 3 key insights 2) Top 3 recommended actions. "
            "Be concise. Do NOT repeat the table. Plain text only, no HTML."
        ))
    except Exception:
        insights = ""
    finally:
        sys.stdout = old_stdout

    return summary_table + "\n\n" + insights


@mcp.tool()
async def get_critical_events_30d() -> str:
    """
    Get upcoming critical events in the next 30 days — analyzed by the AI agent.
    Same as clicking 'Upcoming Critical Events in next 30 days' on the dashboard.
    """
    print("⏳ Running critical events 30-day analysis...", file=sys.stderr, flush=True)
    today = datetime.now()
    tomorrow = (today + timedelta(days=1)).strftime("%Y-%m-%d")
    end = (today + timedelta(days=30)).strftime("%Y-%m-%d")
    events = _scan_critical(tomorrow, end)
    return _analyze_events(events,
        f"Show me all critical events that have start_time between {tomorrow} and {end}. "
        "Query all existing events in the database and filter for those with start_time in this future date range. "
        "Include all events with status 'upcoming' or 'open' and focus on events requiring immediate attention.")


@mcp.tool()
async def get_critical_events_60d() -> str:
    """
    Get upcoming critical events in the next 30 to 60 days — analyzed by the AI agent.
    Same as clicking 'Upcoming Critical Events in the next 30 to 60 days' on the dashboard.
    """
    print("⏳ Running critical events 30-60 day analysis...", file=sys.stderr, flush=True)
    today = datetime.now()
    start = (today + timedelta(days=30)).strftime("%Y-%m-%d")
    end = (today + timedelta(days=60)).strftime("%Y-%m-%d")
    events = _scan_critical(start, end)
    return _analyze_events(events,
        f"Show me all critical events that have start_time between {start} and {end}. "
        "Query all existing events in the database and filter for those with start_time in this future date range. "
        "Include events with status 'upcoming' or 'open' and focus on events requiring attention.")


@mcp.tool()
async def get_past_due_events() -> str:
    """
    Get past due critical events (start_time in the past, still open/upcoming).
    Same as clicking 'Past Due Events - 120 Days' on the dashboard.
    """
    print("⏳ Running past due events analysis...", file=sys.stderr, flush=True)
    today = datetime.now()
    start = (today - timedelta(days=120)).strftime("%Y-%m-%d")
    end = today.strftime("%Y-%m-%d")
    events = _scan_critical(start, end)
    return _analyze_events(events,
        f"Show me all critical events that have start_time between {start} and {end}. "
        "Query all existing events in the database and filter for those with start_time in this past date range. "
        "Include events with status 'upcoming' or 'open' and focus on events that are past due.")


def main():
    """Entry point for the CLI command."""
    import argparse
    from starlette.requests import Request
    from starlette.responses import JSONResponse

    @mcp.custom_route("/health", methods=["GET"])
    async def health(request: Request) -> JSONResponse:
        return JSONResponse({"status": "healthy"})

    parser = argparse.ArgumentParser()
    parser.add_argument("--transport", choices=["stdio", "streamable-http"], default="stdio")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8080)
    args = parser.parse_args()

    if args.transport == "streamable-http":
        mcp.settings.host = args.host
        mcp.settings.port = args.port
    mcp.run(transport=args.transport)


if __name__ == "__main__":
    main()
