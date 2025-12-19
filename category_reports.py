#!/usr/bin/env python3
"""
Generate Category-Based Reports
"""

import json
import glob
import os
from datetime import datetime

def generate_category_reports():
    """Generate separate reports for each category"""
    
    # Find latest classification report
    report_files = glob.glob("output/health_insights_classified_*.json")
    if not report_files:
        print("❌ No classification report found")
        return
    
    latest_report = max(report_files, key=os.path.getctime)
    
    with open(latest_report, 'r') as f:
        data = json.load(f)
    
    categories = data['detailed_categories']
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    
    print("📊 GENERATING CATEGORY REPORTS")
    print("=" * 50)
    
    for category, category_data in categories.items():
        if category == 'unclassified':
            continue
            
        events = category_data['events']
        
        # Create category report
        report = {
            'category': category,
            'description': category_data.get('description', ''),
            'summary': {
                'total_events': len(events),
                'upcoming_events': len([e for e in events if e.get('status') == 'upcoming']),
                'services_affected': len(set(e.get('service') for e in events)),
                'regions_affected': len(set(e.get('region') for e in events))
            },
            'events_by_service': {},
            'events_by_region': {},
            'events_by_status': {},
            'all_events': events
        }
        
        # Group by service
        for event in events:
            service = event.get('service', 'unknown')
            if service not in report['events_by_service']:
                report['events_by_service'][service] = []
            report['events_by_service'][service].append(event)
        
        # Group by region  
        for event in events:
            region = event.get('region', 'unknown')
            if region not in report['events_by_region']:
                report['events_by_region'][region] = []
            report['events_by_region'][region].append(event)
        
        # Group by status
        for event in events:
            status = event.get('status', 'unknown')
            if status not in report['events_by_status']:
                report['events_by_status'][status] = []
            report['events_by_status'][status].append(event)
        
        # Save category report
        filename = f"output/category_{category}_{timestamp}.json"
        with open(filename, 'w') as f:
            json.dump(report, f, indent=2, default=str)
        
        print(f"✅ {category.replace('_', ' ').title()}: {len(events)} events → {filename}")
        print(f"   • Upcoming: {report['summary']['upcoming_events']}")
        print(f"   • Services: {report['summary']['services_affected']}")
        print(f"   • Regions: {report['summary']['regions_affected']}")
        print()

if __name__ == "__main__":
    generate_category_reports()
