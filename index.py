import json
import boto3
import os
from datetime import datetime

dynamodb = boto3.resource('dynamodb')
s3 = boto3.client('s3')
table = dynamodb.Table(os.environ['DYNAMODB_TABLE'])

def lambda_handler(event, context):
    print(f"Received event: {json.dumps(event)}")
    
    for record in event['Records']:
        bucket = record['s3']['bucket']['name']
        key = record['s3']['object']['key']
        
        if not key.endswith('.json'):
            print(f"Skipping non-JSON file: {key}")
            continue
        
        try:
            response = s3.get_object(Bucket=bucket, Key=key)
            data = json.loads(response['Body'].read().decode('utf-8'))
            
            # Handle both formats:
            # 1. Array format: {"events": [...]}
            # 2. Single event format from upload_health.py
            events = []
            if 'events' in data:
                events = data['events']
            elif 'arn' in data:
                # Single event file from data pipeline
                events = [data]
            else:
                print(f"Unknown format in {key}")
                continue
            
            print(f"Processing {len(events)} events from {key}")
            
            with table.batch_writer() as batch:
                for event_data in events:
                    # Extract event type for frontend compatibility
                    event_type_code = event_data.get('eventTypeCode', '')
                    event_type_category = event_data.get('eventTypeCategory', '')
                    service = event_data.get('service', '')
                    arn = event_data.get('arn', '')
                    
                    # Create the __summary structure that server.js expects
                    summary_structure = {
                        'title': f"{service} - {event_type_code}" if service and event_type_code else (service or event_type_code or 'Health Event'),
                        'schedule': [{
                            'event': event_type_code,
                            'datetime': event_data.get('startTime', '')
                        }],
                        'risk': 'N/A'  # Default risk level
                    }
                    
                    # Map event category for classification
                    event_category = 'issue'  # default
                    if 'scheduled' in event_type_code.lower() or 'maintenance' in event_type_code.lower():
                        event_category = 'scheduledChange'
                    elif event_type_category == 'accountNotification':
                        event_category = 'accountNotification'
                    elif 'investigation' in event_type_code.lower():
                        event_category = 'investigation'
                    
                    item = {
                        'healthkey': arn,
                        'arn': arn,                           # Direct ARN field for React component
                        'event_type': event_type_code,        # Direct event_type field for server.js fallback
                        'eventCategory': event_category,      # Category for classification
                        'name': f"{service} Health Event",    # Name field for server.js fallback
                        '__summary': summary_structure,       # Summary structure for server.js primary lookup
                        'status_code': event_data.get('statusCode', 'unknown'),
                        'start_time': str(event_data.get('startTime', '')),
                        'last_update': str(event_data.get('lastUpdatedTime', event_data.get('startTime', ''))),
                        'service': service,
                        'event_type_code': event_type_code,
                        'event_type_category': event_type_category,
                        'region': event_data.get('region', ''),
                        'end_time': str(event_data.get('endTime', '')),
                        'last_updated_time': str(event_data.get('lastUpdatedTime', '')),
                        'event_scope_code': event_data.get('eventScopeCode', ''),
                        'description': event_data.get('details', ''),
                        'details': event_data.get('details', ''),
                        'raw_data': json.dumps(event_data)
                    }
                    batch.put_item(Item=item)
            
            print(f"Successfully loaded {len(events)} events to DynamoDB")
            
        except Exception as e:
            print(f"Error processing {key}: {str(e)}")
            raise
    
    return {'statusCode': 200, 'body': 'Success'}