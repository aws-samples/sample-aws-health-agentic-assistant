#!/usr/bin/env python3
"""
Health Event Insights Categorizer
Generates categorized reports with drill-down capabilities
"""

import json
import boto3
from datetime import datetime, timedelta
from strands import Agent, tool
from strands.models import BedrockModel
from typing import Dict, List, Any

class HealthInsightsCategorizer:
    def __init__(self):
        self.health_client = boto3.client('health', region_name='us-east-1')
        self.bedrock_model = BedrockModel(
            model_id="us.amazon.nova-premier-v1:0",
            temperature=0.1,
            top_p=0.9,
        )
        
        # Insight categories mapping
        self.categories = {
            "migration_requirements": {
                "keywords": ["migration", "upgrade", "amazon linux", "instance family", "platform"],
                "patterns": ["AWS_.*_PLANNED_LIFECYCLE_EVENT"]
            },
            "security_updates": {
                "keywords": ["security", "patch", "vulnerability", "end of security support"],
                "patterns": ["AWS_.*_SECURITY_NOTIFICATION"]
            },
            "service_deprecations": {
                "keywords": ["end of life", "deprecation", "end of support", "retirement"],
                "patterns": ["AWS_.*_PLANNED_LIFECYCLE_EVENT"]
            },
            "automatic_updates": {
                "keywords": ["automatic", "maintenance window", "scheduled upgrade"],
                "patterns": ["AWS_.*_MAINTENANCE_SCHEDULED"]
            },
            "cost_impact_events": {
                "keywords": ["reserved instance", "billing", "cost", "pricing"],
                "patterns": ["AWS_.*_BILLING_NOTIFICATION"]
            },
            "version_management": {
                "keywords": ["version", "kafka", "postgresql", "mysql", "redis"],
                "patterns": ["AWS_.*_PLANNED_LIFECYCLE_EVENT"]
            }
        }
    
    def fetch_events_with_descriptions(self, days_back: int = 90) -> List[Dict[str, Any]]:
        """Fetch health events with full descriptions"""
        
        end_date = datetime.now()
        start_date = end_date - timedelta(days=days_back)
        
        # Get events
        response = self.health_client.describe_events(
            filter={
                'startTimes': [{
                    'from': start_date,
                    'to': end_date
                }]
            },
            maxResults=100
        )
        
        events_with_descriptions = []
        
        for event in response.get('events', []):
            try:
                # Get event details with description
                details = self.health_client.describe_event_details(
                    eventArns=[event['arn']]
                )
                
                if details['successfulSet']:
                    event_detail = details['successfulSet'][0]
                    description = event_detail.get('eventDescription', {}).get('latestDescription', '')
                    
                    # Get affected resources
                    entities = self.health_client.describe_affected_entities(
                        filter={'eventArns': [event['arn']]}
                    )
                    
                    event_data = {
                        **event,
                        'description': description,
                        'affected_resources': [e.get('entityValue', '') for e in entities.get('entities', [])]
                    }
                    events_with_descriptions.append(event_data)
                    
            except Exception as e:
                print(f"Error processing event {event.get('arn', 'unknown')}: {e}")
                continue
        
        return events_with_descriptions
    
    def categorize_event(self, event: Dict[str, Any]) -> List[str]:
        """Categorize an event using Bedrock AI"""
        
        description = event.get('description', '')
        service = event.get('service', '')
        event_type = event.get('eventTypeCode', '')
        
        prompt = f"""Analyze this AWS Health event and categorize it. Return ONLY a JSON array of applicable categories:

Event: {event_type}
Service: {service}
Description: {description}

Categories to choose from:
- migration_requirements: Platform/instance/version migrations
- security_updates: Security patches, vulnerabilities, end of security support
- service_deprecations: End-of-life, feature deprecations
- automatic_updates: Scheduled maintenance, automatic upgrades
- cost_impact_events: Billing changes, Reserved Instance impacts
- version_management: Version upgrades, end-of-support versions

Return JSON array only: ["category1", "category2"]"""

        agent = Agent(model=self.bedrock_model)
        response = agent(prompt)
        
        try:
            response_text = str(response).strip()
            # Extract JSON array from response
            if '[' in response_text and ']' in response_text:
                start = response_text.find('[')
                end = response_text.rfind(']') + 1
                json_str = response_text[start:end]
                return json.loads(json_str)
            return []
        except:
            return []
    
    def generate_insights_report(self, days_back: int = 90) -> Dict[str, Any]:
        """Generate categorized insights report"""
        
        print("Fetching health events with descriptions...")
        events = self.fetch_events_with_descriptions(days_back)
        
        print(f"Categorizing {len(events)} events...")
        
        # Initialize report structure
        report = {
            "generated_at": datetime.now().isoformat(),
            "events_analyzed": len(events),
            "categories": {},
            "summary": {}
        }
        
        # Process each event
        for event in events:
            categories = self.categorize_event(event)
            
            for category in categories:
                if category not in report["categories"]:
                    report["categories"][category] = {
                        "count": 0,
                        "events": []
                    }
                
                # Add event details for drill-down
                event_summary = {
                    "arn": event.get('arn', ''),
                    "service": event.get('service', ''),
                    "region": event.get('region', ''),
                    "event_type": event.get('eventTypeCode', ''),
                    "status": event.get('statusCode', ''),
                    "start_time": str(event.get('startTime', '')),
                    "title": event.get('description', '')[:100] + "..." if len(event.get('description', '')) > 100 else event.get('description', ''),
                    "affected_resources_count": len(event.get('affected_resources', [])),
                    "affected_resources": event.get('affected_resources', [])[:5]  # First 5 for summary
                }
                
                report["categories"][category]["events"].append(event_summary)
                report["categories"][category]["count"] += 1
        
        # Generate summary
        report["summary"] = {
            "total_categories": len(report["categories"]),
            "top_categories": sorted(
                [(cat, data["count"]) for cat, data in report["categories"].items()],
                key=lambda x: x[1],
                reverse=True
            )[:5]
        }
        
        return report
    
    def save_report(self, report: Dict[str, Any], output_dir: str = "output"):
        """Save categorized report to JSON file"""
        
        import os
        os.makedirs(output_dir, exist_ok=True)
        
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        filename = f"{output_dir}/health_insights_report_{timestamp}.json"
        
        with open(filename, 'w') as f:
            json.dump(report, f, indent=2, default=str)
        
        return filename

def main():
    """Generate insights report"""
    
    categorizer = HealthInsightsCategorizer()
    
    print("🔍 Generating Health Insights Report...")
    report = categorizer.generate_insights_report(days_back=90)
    
    filename = categorizer.save_report(report)
    
    print(f"✅ Report generated!")
    print(f"📁 Saved to: {filename}")
    print(f"📊 Events analyzed: {report['events_analyzed']}")
    print(f"📋 Categories found: {report['summary']['total_categories']}")
    
    print("\n🏆 Top Categories:")
    for category, count in report['summary']['top_categories']:
        print(f"  • {category.replace('_', ' ').title()}: {count} events")

if __name__ == "__main__":
    main()
