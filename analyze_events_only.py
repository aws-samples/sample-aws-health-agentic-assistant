#!/usr/bin/env python3
"""Analyze pre-fetched health events with LLM — no DynamoDB query generation."""

import sys
import os
import json

sys.path.append(os.path.join(os.path.dirname(__file__), 'agents'))

from strands import Agent
from strands.models.bedrock import BedrockModel
from agentic_analysis_simple import enhance_events_with_drill_down_urls


def analyze_prefetched_events(events, user_prompt):
    """Take pre-fetched events and run LLM analysis/formatting only."""
    if not events:
        return "<html><body><h3>No events found matching your criteria.</h3></body></html>"

    events = enhance_events_with_drill_down_urls(events)

    if len(events) > 50:
        data_for_analysis = {
            "total_records": len(events),
            "services": {},
            "event_types": {},
            "status_codes": {},
            "sample_records": events[:10],
            "recent_records": sorted(events, key=lambda x: x.get('start_time', ''), reverse=True)[:20]
        }
        for e in events:
            svc = e.get('service', 'Unknown')
            et = e.get('event_type', 'Unknown')
            sc = e.get('status_code', 'Unknown')
            data_for_analysis["services"][svc] = data_for_analysis["services"].get(svc, 0) + 1
            data_for_analysis["event_types"][et] = data_for_analysis["event_types"].get(et, 0) + 1
            data_for_analysis["status_codes"][sc] = data_for_analysis["status_codes"].get(sc, 0) + 1
    else:
        data_for_analysis = {"full_data": events}

    model = BedrockModel(
        model_id="global.anthropic.claude-sonnet-4-20250514-v1:0",
        region_name="us-east-1",
        temperature=0.1
    )
    agent = Agent(model=model)

    analysis_prompt = f"""
Analyze AWS Health events for: {user_prompt}

DATA: {json.dumps(data_for_analysis, indent=2, default=str)}

Provide a complete but CONCISE HTML document with:
1. One summary table showing only the most critical events with CLICKABLE DRILL-DOWN LINKS
2. Top 2 most relevant insights only
3. Brief recommendations (maximum 3 bullet points)
4. One follow-up question

CRITICAL DRILL-DOWN REQUIREMENTS:
- Each event includes a 'drill_down_url' field with pre-generated filters
- Use the provided 'drill_down_url' field directly in your HTML links
- DO NOT create your own filter URLs
- Format: <a href="[drill_down_url]" class="drill-down-link">View Details</a>

TABLE STRUCTURE:
- Include columns: Time, AWS Service, Title, Event, Status, Actions
- The Actions column should contain the drill-down link

CRITICAL: Keep response under 2000 characters. Response must be a complete HTML document
starting with <html> and ending with </html>. Include minimal CSS styling. Use only HTML tags.
"""

    for attempt in range(3):
        try:
            response = agent(analysis_prompt)
            return str(response)
        except Exception as e:
            if 'serviceunavailable' in str(e).lower() and attempt < 2:
                import time
                time.sleep(2 ** (attempt + 1))
                continue
            raise

    return "<html><body><h2>Service Temporarily Unavailable</h2><p>Please try again.</p></body></html>"


def main():
    """Read events JSON from stdin, prompt from argv[1], output HTML analysis."""
    if len(sys.argv) != 2:
        print("Usage: echo '<events_json>' | python analyze_events_only.py '<prompt>'", file=sys.stderr)
        sys.exit(1)

    prompt = sys.argv[1]
    events_json = sys.stdin.read()

    try:
        events = json.loads(events_json)
    except json.JSONDecodeError as e:
        print(f"Invalid JSON input: {e}", file=sys.stderr)
        sys.exit(1)

    try:
        result = analyze_prefetched_events(events, prompt)
        print(result, flush=True)
    except Exception as e:
        error_html = f"""<html><body>
<h2>Analysis Error</h2>
<p>{str(e)}</p>
</body></html>"""
        print(error_html, flush=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
