#!/usr/bin/env python3
"""
SQL Query Agent - Single Responsibility: Convert natural language to queries and execute them
"""

from strands import Agent
from strands.models.bedrock import BedrockModel
import json
import os
from collections import Counter

os.environ["BYPASS_TOOL_CONSENT"] = "true"

class SQLQueryAgent:
    def __init__(self):
        self.model = BedrockModel(
            model_id="us.anthropic.claude-3-5-sonnet-20241022-v2:0",
            region_name="us-east-1",
            temperature=0.1
        )
        
        SQL_SYSTEM_PROMPT = """
        You are a SQL Query Generation and Execution specialist agent.
        
        Your ONLY responsibility is to:
        1. Convert natural language questions into executable logic
        2. Execute that logic on the provided health events data
        3. Return quantitative results
        
        You do NOT analyze or interpret the business meaning - you only provide data.
        
        Health events data structure:
        - arn, service, event_type, eventCategory, region, start_time, end_time, 
          last_update, status_code, description
        
        Always return structured data results, not business analysis.
        """
        
        self.agent = Agent(
            system_prompt=SQL_SYSTEM_PROMPT,
            model=self.model
        )
    
    def execute_query(self, natural_language_question: str, events_data: list) -> dict:
        """
        Single Responsibility: Convert natural language to query logic and execute it
        Returns comprehensive numerical analysis - NO business interpretation
        """
        
        prompt = f"""
        Convert this natural language question into executable logic and return numerical analysis:
        
        Question: {natural_language_question}
        
        Data to query: {len(events_data)} health events
        
        Execute the logic and return comprehensive numerical results in JSON format:
        {{
            "query_executed": "description of what was queried",
            "total_records": number,
            "filtered_count": number,
            "numerical_analysis": {{
                "counts": {{}},
                "percentages": {{}},
                "distributions": {{}},
                "time_analysis": {{}},
                "statistical_summary": {{}}
            }}
        }}
        
        Provide ONLY numerical data - no business analysis or recommendations.
        """
        
        # Get the query logic from Bedrock
        response = self.agent(prompt)
        
        # Execute comprehensive numerical analysis
        try:
            # Parse what kind of query is needed and filter data
            if "maintenance" in natural_language_question.lower():
                filtered_events = [e for e in events_data if "MAINTENANCE" in e.get("event_type", "") or "UPDATE" in e.get("event_type", "")]
            elif "security" in natural_language_question.lower():
                filtered_events = [e for e in events_data if "SECURITY" in e.get("event_type", "")]
            elif "lifecycle" in natural_language_question.lower() or "ple" in natural_language_question.lower():
                filtered_events = [e for e in events_data if "PLANNED_LIFECYCLE_EVENT" in e.get("event_type", "")]
            elif "cost" in natural_language_question.lower() or "billing" in natural_language_question.lower():
                filtered_events = [e for e in events_data if "BILLING" in e.get("event_type", "") or "ODCR" in e.get("event_type", "")]
            elif "upcoming" in natural_language_question.lower():
                filtered_events = [e for e in events_data if e.get("status_code") == "upcoming"]
            else:
                filtered_events = events_data
            
            # Comprehensive numerical analysis
            from collections import Counter
            from datetime import datetime, timedelta
            
            # Basic counts
            service_counts = Counter(e.get("service") for e in filtered_events)
            status_counts = Counter(e.get("status_code") for e in filtered_events)
            region_counts = Counter(e.get("region") for e in filtered_events)
            event_type_counts = Counter(e.get("event_type") for e in filtered_events)
            
            # Percentages
            total_filtered = len(filtered_events)
            upcoming_count = len([e for e in filtered_events if e.get("status_code") == "upcoming"])
            open_count = len([e for e in filtered_events if e.get("status_code") == "open"])
            closed_count = len([e for e in filtered_events if e.get("status_code") == "closed"])
            
            # Time-based analysis
            now = datetime.now()
            next_30_days = now + timedelta(days=30)
            next_90_days = now + timedelta(days=90)
            
            events_30_days = 0
            events_90_days = 0
            
            for event in filtered_events:
                start_time_str = event.get("start_time", "")
                if start_time_str:
                    try:
                        # Parse different datetime formats
                        if "T" in start_time_str:
                            event_date = datetime.fromisoformat(start_time_str.replace("Z", "+00:00"))
                        else:
                            continue
                        
                        if event_date <= next_30_days:
                            events_30_days += 1
                        if event_date <= next_90_days:
                            events_90_days += 1
                    except:
                        continue
            
            # Statistical summary
            avg_events_per_service = total_filtered / len(service_counts) if service_counts else 0
            max_service_events = max(service_counts.values()) if service_counts else 0
            min_service_events = min(service_counts.values()) if service_counts else 0
            
            return {
                "query_executed": natural_language_question,
                "total_records": len(events_data),
                "filtered_count": total_filtered,
                "numerical_analysis": {
                    "counts": {
                        "by_service": dict(service_counts.most_common()),
                        "by_status": dict(status_counts),
                        "by_region": dict(region_counts),
                        "by_event_type": dict(event_type_counts.most_common(10)),
                        "upcoming": upcoming_count,
                        "open": open_count,
                        "closed": closed_count
                    },
                    "percentages": {
                        "upcoming_percentage": round((upcoming_count / total_filtered) * 100, 1) if total_filtered > 0 else 0,
                        "open_percentage": round((open_count / total_filtered) * 100, 1) if total_filtered > 0 else 0,
                        "closed_percentage": round((closed_count / total_filtered) * 100, 1) if total_filtered > 0 else 0,
                        "filtered_vs_total": round((total_filtered / len(events_data)) * 100, 1) if events_data else 0
                    },
                    "distributions": {
                        "top_3_services": dict(service_counts.most_common(3)),
                        "top_3_regions": dict(region_counts.most_common(3)),
                        "service_concentration": round((max_service_events / total_filtered) * 100, 1) if total_filtered > 0 else 0
                    },
                    "time_analysis": {
                        "events_next_30_days": events_30_days,
                        "events_next_90_days": events_90_days,
                        "percentage_next_30_days": round((events_30_days / total_filtered) * 100, 1) if total_filtered > 0 else 0,
                        "percentage_next_90_days": round((events_90_days / total_filtered) * 100, 1) if total_filtered > 0 else 0
                    },
                    "statistical_summary": {
                        "unique_services": len(service_counts),
                        "unique_regions": len(region_counts),
                        "unique_event_types": len(event_type_counts),
                        "avg_events_per_service": round(avg_events_per_service, 1),
                        "max_events_single_service": max_service_events,
                        "min_events_single_service": min_service_events
                    }
                }
            }
            
        except Exception as e:
            return {
                "error": f"Query execution failed: {str(e)}",
                "query_attempted": natural_language_question,
                "bedrock_response": str(response)
            }
