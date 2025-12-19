#!/usr/bin/env python3
"""
Health Event Pattern-Based Classifier
Maps event_type patterns to business categories based on data analysis
"""

import json
import re
from datetime import datetime
from collections import Counter, defaultdict
from typing import Dict, List, Any

class HealthEventClassifier:
    def __init__(self):
        # Pattern mappings based on data analysis
        self.category_patterns = {
            "migration_requirements": {
                "patterns": [
                    r".*_PLANNED_LIFECYCLE_EVENT$",
                    r".*_PERSISTENT_INSTANCE_RETIREMENT_SCHEDULED$",
                    r".*_TASK_PATCHING_RETIREMENT$",
                    r".*_VM_DEPRECATED$"
                ],
                "description": "Platform migrations, version upgrades, instance retirements"
            },
            "security_compliance": {
                "patterns": [
                    r".*_SECURITY_NOTIFICATION$",
                    r".*_SECURITY_PATCHING_EVENT$"
                ],
                "description": "Security patches, vulnerability notifications"
            },
            "maintenance_updates": {
                "patterns": [
                    r".*_MAINTENANCE_SCHEDULED$",
                    r".*_MAINTENANCE_COMPLETE$",
                    r".*_MAINTENANCE_EXTENSION$",
                    r".*_UPDATE_AVAILABLE$",
                    r".*_UPDATE_COMPLETED$",
                    r".*_AUTO_UPGRADE_NOTIFICATION$",
                    r".*_UPCOMING_MAINTENANCE$"
                ],
                "description": "Scheduled maintenance, automatic updates"
            },
            "cost_impact_events": {
                "patterns": [
                    r"AWS_BILLING_NOTIFICATION$",
                    r".*_ODCR_.*",
                    r".*_SUBSCRIPTION_RENEWAL.*",
                    r".*_CAPACITY_.*",
                    r".*_UNDERUTILIZATION.*"
                ],
                "description": "Billing changes, capacity reservations, cost impacts"
            },
            "operational_notifications": {
                "patterns": [
                    r".*_OPERATIONAL_NOTIFICATION$",
                    r".*_OPERATIONAL_ISSUE$",
                    r".*_SERVICE_ISSUE$",
                    r".*_CLUSTER_HEALTH_ISSUES$",
                    r".*_POD_EVICTIONS$",
                    r".*_REDUNDANCY_LOSS$",
                    r".*_TUNNEL_NOTIFICATION$",
                    r".*_EXPERIMENT_EVENT$"
                ],
                "description": "Service issues, operational alerts"
            },
            "configuration_alerts": {
                "patterns": [
                    r".*_HIGH_RISK_CONFIG.*",
                    r".*_PERSISTENCE_EXPIRING$",
                    r".*_RENEWAL_STATE_CHANGE$",
                    r".*_CUSTOMER_ENGAGEMENT$",
                    r".*_RUNAWAY_TERMINATION.*"
                ],
                "description": "Configuration issues, expiring resources"
            }
        }
    
    def classify_event(self, event: Dict[str, Any]) -> str:
        """Classify a single event based on event_type patterns"""
        
        event_type = event.get('event_type', '')
        
        for category, config in self.category_patterns.items():
            for pattern in config['patterns']:
                if re.match(pattern, event_type):
                    return category
        
        return "unclassified"
    
    def process_events(self, events: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Process and classify all events"""
        
        classified_events = []
        category_stats = defaultdict(lambda: {
            'count': 0,
            'services': set(),
            'event_types': set(),
            'upcoming_count': 0,
            'events': []
        })
        
        for event in events:
            # Classify the event
            category = self.classify_event(event)
            
            # Add classification to event
            event_with_category = {
                **event,
                'business_category': category,
                'category_description': self.category_patterns.get(category, {}).get('description', 'Unclassified events')
            }
            classified_events.append(event_with_category)
            
            # Update statistics
            stats = category_stats[category]
            stats['count'] += 1
            stats['services'].add(event.get('service', 'unknown'))
            stats['event_types'].add(event.get('event_type', 'unknown'))
            
            if event.get('status_code') == 'upcoming':
                stats['upcoming_count'] += 1
            
            # Store event summary for drill-down
            event_summary = {
                'arn': event.get('arn', ''),
                'service': event.get('service', ''),
                'region': event.get('region', ''),
                'event_type': event.get('event_type', ''),
                'status': event.get('status_code', ''),
                'start_time': event.get('start_time', ''),
                'last_update': event.get('last_update', ''),
                'description_preview': (event.get('description', '') or '')[:150] + "..." if len(event.get('description', '') or '') > 150 else event.get('description', '')
            }
            stats['events'].append(event_summary)
        
        # Convert sets to lists for JSON serialization
        for category in category_stats:
            category_stats[category]['services'] = list(category_stats[category]['services'])
            category_stats[category]['event_types'] = list(category_stats[category]['event_types'])
        
        return {
            'classified_events': classified_events,
            'category_statistics': dict(category_stats)
        }
    
    def generate_insights_report(self, events: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Generate comprehensive insights report"""
        
        results = self.process_events(events)
        classified_events = results['classified_events']
        category_stats = results['category_statistics']
        
        # Overall statistics
        total_events = len(classified_events)
        upcoming_events = sum(1 for e in classified_events if e.get('status_code') == 'upcoming')
        
        # Top services and event types
        service_counts = Counter(e.get('service', 'unknown') for e in classified_events)
        event_type_counts = Counter(e.get('event_type', 'unknown') for e in classified_events)
        
        # Category summary with business impact
        category_summary = []
        for category, stats in category_stats.items():
            impact_level = self._assess_business_impact(category, stats)
            
            category_summary.append({
                'category': category,
                'description': self.category_patterns.get(category, {}).get('description', 'Unclassified'),
                'total_events': stats['count'],
                'upcoming_events': stats['upcoming_count'],
                'affected_services': len(stats['services']),
                'unique_event_types': len(stats['event_types']),
                'business_impact': impact_level,
                'percentage_of_total': round((stats['count'] / total_events) * 100, 1)
            })
        
        # Sort by business impact and event count
        category_summary.sort(key=lambda x: (x['business_impact'], x['total_events']), reverse=True)
        
        report = {
            'generated_at': datetime.now().isoformat(),
            'summary': {
                'total_events_analyzed': total_events,
                'upcoming_events_requiring_action': upcoming_events,
                'action_required_percentage': round((upcoming_events / total_events) * 100, 1),
                'categories_identified': len(category_stats),
                'classification_coverage': round(((total_events - category_stats.get('unclassified', {}).get('count', 0)) / total_events) * 100, 1)
            },
            'category_insights': category_summary,
            'top_services': [{'service': s, 'event_count': c} for s, c in service_counts.most_common(10)],
            'top_event_types': [{'event_type': et, 'count': c} for et, c in event_type_counts.most_common(10)],
            'detailed_categories': category_stats
        }
        
        return report
    
    def _assess_business_impact(self, category: str, stats: Dict) -> str:
        """Assess business impact level for a category"""
        
        upcoming_ratio = stats['upcoming_count'] / max(stats['count'], 1)
        
        if category == 'migration_requirements' and upcoming_ratio > 0.3:
            return 'high'
        elif category == 'security_compliance' and stats['upcoming_count'] > 0:
            return 'high'
        elif category == 'cost_impact_events' and upcoming_ratio > 0.2:
            return 'medium'
        elif category == 'maintenance_updates' and upcoming_ratio > 0.4:
            return 'medium'
        else:
            return 'low'

def main():
    """Process health events and generate insights report"""
    
    import os
    
    classifier = HealthEventClassifier()
    
    # Load events from DynamoDB
    try:
        from dynamodb_reader import load_events_from_dynamodb
        events = load_events_from_dynamodb()
        print(f"📊 Loaded {len(events)} health events from DynamoDB")
    except Exception as e:
        print(f"❌ Error loading from DynamoDB: {str(e)}")
        return
    
    # Generate insights report
    print("🔍 Classifying events and generating insights...")
    report = classifier.generate_insights_report(events)
    
    # Create output directory and save report
    os.makedirs("output", exist_ok=True)
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    output_file = f"output/health_insights_classified_{timestamp}.json"
    
    with open(output_file, 'w') as f:
        json.dump(report, f, indent=2, default=str)
    
    # Print summary
    print(f"✅ Classification complete!")
    print(f"📁 Report saved to: {output_file}")
    print(f"📈 Summary:")
    print(f"   • Total events: {report['summary']['total_events_analyzed']}")
    print(f"   • Upcoming actions needed: {report['summary']['upcoming_events_requiring_action']} ({report['summary']['action_required_percentage']}%)")
    print(f"   • Classification coverage: {report['summary']['classification_coverage']}%")
    print(f"   • Categories identified: {report['summary']['categories_identified']}")
    
    print(f"\n🏆 Top Business Categories:")
    for cat in report['category_insights'][:5]:
        print(f"   • {cat['category'].replace('_', ' ').title()}: {cat['total_events']} events ({cat['percentage_of_total']}%) - {cat['business_impact'].upper()} impact")

if __name__ == "__main__":
    main()
