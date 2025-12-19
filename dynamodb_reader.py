#!/usr/bin/env python3
"""
DynamoDB Reader for CHAPLIN Health Events
Minimal utility to read events from DynamoDB table
"""

import boto3
import json
from botocore.exceptions import ClientError
import logging

logger = logging.getLogger(__name__)

class DynamoDBReader:
    def __init__(self, table_name='chaplin-health-events'):
        self.table_name = table_name
        self.dynamodb = boto3.resource('dynamodb')
        self.table = self.dynamodb.Table(table_name)
    
    def read_events(self, limit=None):
        """Read events from DynamoDB table"""
        try:
            events = []
            scan_kwargs = {}
            
            if limit:
                scan_kwargs['Limit'] = limit
            
            # Scan the table
            response = self.table.scan(**scan_kwargs)
            events.extend(response['Items'])
            
            # Handle pagination if no limit specified
            while 'LastEvaluatedKey' in response and not limit:
                scan_kwargs['ExclusiveStartKey'] = response['LastEvaluatedKey']
                response = self.table.scan(**scan_kwargs)
                events.extend(response['Items'])
            
            logger.info(f"Retrieved {len(events)} events from DynamoDB")
            return events
            
        except ClientError as e:
            logger.error(f"DynamoDB error: {e}")
            raise
        except Exception as e:
            logger.error(f"Unexpected error reading from DynamoDB: {e}")
            raise

def load_events_from_dynamodb(limit=None):
    """Convenience function to load events from DynamoDB"""
    reader = DynamoDBReader()
    return reader.read_events(limit)

def get_drill_down_details(filter_criteria):
    """
    Get detailed events for drill-down based on filter criteria
    
    Args:
        filter_criteria (dict): Dictionary containing filter criteria like:
            - account: AWS account ID
            - region: AWS region
            - eventCategory: Event category
            - service: AWS service name
            - status_code: Event status
    
    Returns:
        list: List of events matching the criteria, sorted by Account, Region, eventCategory, Start_time
    """
    try:
        logger.info(f"Getting drill-down details with filters: {filter_criteria}")
        
        reader = DynamoDBReader()
        
        # Build scan parameters
        scan_kwargs = {}
        filter_expressions = []
        expression_attribute_values = {}
        expression_attribute_names = {}
        
        # Add filters based on criteria
        if filter_criteria.get('account'):
            filter_expressions.append('#account = :account')
            expression_attribute_names['#account'] = 'account'
            expression_attribute_values[':account'] = filter_criteria['account']
        
        if filter_criteria.get('region'):
            filter_expressions.append('#region = :region')
            expression_attribute_names['#region'] = 'region'
            expression_attribute_values[':region'] = filter_criteria['region']
        
        if filter_criteria.get('eventCategory'):
            filter_expressions.append('eventCategory = :eventCategory')
            expression_attribute_values[':eventCategory'] = filter_criteria['eventCategory']
        
        if filter_criteria.get('service'):
            filter_expressions.append('#service = :service')
            expression_attribute_names['#service'] = 'service'
            expression_attribute_values[':service'] = filter_criteria['service']
        
        if filter_criteria.get('status_code'):
            filter_expressions.append('status_code = :status_code')
            expression_attribute_values[':status_code'] = filter_criteria['status_code']
        
        # Apply filters if any exist
        if filter_expressions:
            scan_kwargs['FilterExpression'] = ' AND '.join(filter_expressions)
            scan_kwargs['ExpressionAttributeValues'] = expression_attribute_values
            
            if expression_attribute_names:
                scan_kwargs['ExpressionAttributeNames'] = expression_attribute_names
        
        # Scan all pages
        events = []
        response = reader.table.scan(**scan_kwargs)
        events.extend(response['Items'])
        
        # Handle pagination
        while 'LastEvaluatedKey' in response:
            scan_kwargs['ExclusiveStartKey'] = response['LastEvaluatedKey']
            response = reader.table.scan(**scan_kwargs)
            events.extend(response['Items'])
        
        # Sort by Account, Region, eventCategory, Start_time
        events.sort(key=lambda x: (
            x.get('account', ''),
            x.get('region', ''),
            x.get('eventCategory', ''),
            x.get('start_time', '')
        ))
        
        logger.info(f"Retrieved {len(events)} events for drill-down")
        return events
        
    except Exception as e:
        logger.error(f"Error getting drill-down details: {e}")
        raise