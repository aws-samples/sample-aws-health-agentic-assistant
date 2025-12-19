import boto3
import json
import logging
from datetime import datetime
from typing import Dict, Any, List
from strands import Agent, tool
from strands.models.bedrock import BedrockModel

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Define models with fallback

MODELS = [
    BedrockModel(model_id="us.anthropic.claude-3-5-sonnet-20241022-v2:0", region_name="us-east-1", temperature=0.1),
    BedrockModel(model_id="us.anthropic.claude-3-7-sonnet-20250219-v1:0", region_name="us-east-1", temperature=0.1),
    BedrockModel(model_id="global.anthropic.claude-sonnet-4-20250514-v1:0", region_name="us-east-1", temperature=0.1)
]

'''
MODELS = [
    BedrockModel(model_id="us.meta.llama3-1-70b-instruct-v1:0", region_name="us-east-1", temperature=0.1, stream=False),
    BedrockModel(model_id="us.meta.llama3-1-70b-instruct-v1:0", region_name="us-east-1", temperature=0.1, stream=False),
    BedrockModel(model_id="us.meta.llama3-1-70b-instruct-v1:0", region_name="us-east-1", temperature=0.1, stream=False)
]
'''


MAX_RETRIES_PER_MODEL = 2
RETRY_DELAY = 1

def load_table_structure() -> Dict[str, Any]:
    """Load and analyze the DynamoDB table structure"""
    try:
        dynamodb = boto3.resource('dynamodb', region_name='us-east-1')
        table = dynamodb.Table('chaplin-health-events')
        
        # Get table description
        table_info = table.meta.client.describe_table(TableName='chaplin-health-events')
        
        # Sample a few records to understand the data structure
        sample_response = table.scan(Limit=5)
        sample_records = sample_response.get('Items', [])
        
        # Extract field names and types from sample data
        field_info = {}
        for record in sample_records:
            for key, value in record.items():
                if key not in field_info:
                    field_info[key] = {
                        'type': type(value).__name__,
                        'sample_value': str(value)[:100] if len(str(value)) > 100 else str(value)
                    }
        
        structure = {
            'table_name': 'chaplin-health-events',
            'key_schema': table_info['Table']['KeySchema'],
            'attributes': table_info['Table']['AttributeDefinitions'],
            'field_info': field_info,
            'sample_records': sample_records[:2]
        }
        
        logger.info(f"Loaded table structure with {len(field_info)} fields")
        return structure
        
    except Exception as e:
        logger.error(f"Error loading table structure: {str(e)}")
        return {}

@tool
def build_and_execute_dynamodb_query(user_prompt: str) -> Dict[str, Any]:
    """
    Build and execute a DynamoDB query based on user prompt and table structure.
    Returns appropriate response based on result count.
    
    Args:
        user_prompt: The user's natural language query
        
    Returns:
        Dictionary with query results or appropriate message
    """
    
    # Load table structure
    table_structure = load_table_structure()
    
    # Generate DynamoDB query using LLM
    query_prompt = f"""
    You are a DynamoDB query expert. Based on the user's request and the table structure provided, generate a valid DynamoDB operation.

    CURRENT DATE: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}

    USER REQUEST: {user_prompt}

    TABLE STRUCTURE:
    {json.dumps(table_structure, indent=2, default=str)}

    AVAILABLE GSI: status_code-index (Partition Key: status_code, Sort Key: start_time)

    IMPORTANT: When the user mentions relative dates like "next 30 days", "last quarter", "coming up", etc., 
    calculate from the CURRENT DATE provided above, not from any hardcoded date.
    
    QUERY STRATEGY: Use broad, inclusive filters rather than restrictive ones:
    - Use contains() for text searches rather than exact matches
    - Use OR conditions to capture variations in field values
    - Avoid overly specific event_type filters unless explicitly requested
    - Consider multiple possible field names and values

    Rules:
    1. CRITICAL: For multiple status values (open AND upcoming, open OR upcoming), use scan operation, NOT query
    2. For single status queries, use query operation with GSI "status_code-index"
    3. KeyConditionExpression CANNOT use IN, OR, AND operators - only =, <, >, <=, >=, BETWEEN, begins_with()
    4. Use FilterExpression for additional filtering beyond the key conditions
    5. For non-status queries, use scan operation on main table
    6. Use ExpressionAttributeNames for reserved words - ensure ALL names used are defined
    7. Use ExpressionAttributeValues for values - ensure ALL values used are defined
    8. Include appropriate ProjectionExpression if only specific fields are needed
    9. Do NOT include field names starting with __ (like __summary) in ProjectionExpression
    10. Do NOT include a Limit parameter - return all matching records
    11. Only reference field names that exist in the table structure provided
    
    Return a JSON object with "operation_type" and "params":
    
    For multiple status values (use scan):
    {{
        "operation_type": "scan",
        "params": {{
            "FilterExpression": "(#status = :status1 OR #status = :status2) AND contains(#desc, :keyword)",
            "ExpressionAttributeNames": {{"#status": "status_code", "#desc": "description"}},
            "ExpressionAttributeValues": {{":status1": "open", ":status2": "upcoming", ":keyword": "security"}}
        }}
    }}
    
    For single status GSI query:
    {{
        "operation_type": "query",
        "params": {{
            "IndexName": "status_code-index",
            "KeyConditionExpression": "#status = :status_val",
            "FilterExpression": "contains(#desc, :keyword)",
            "ExpressionAttributeNames": {{"#status": "status_code", "#desc": "description"}},
            "ExpressionAttributeValues": {{":status_val": "open", ":keyword": "security"}}
        }}
    }}

    For table scan:
    {{
        "operation_type": "scan", 
        "params": {{
            "FilterExpression": "contains(#desc, :keyword)",
            "ExpressionAttributeNames": {{"#desc": "description"}},
            "ExpressionAttributeValues": {{":keyword": "maintenance"}}
        }}
    }}
    """
    
    # Generate query with model fallback
    for model in MODELS:
        for attempt in range(MAX_RETRIES_PER_MODEL):
            try:
                agent = Agent(model=model)
                response = agent(query_prompt)
                
                # Extract JSON from response
                response_text = str(response).strip()
                json_start = response_text.find('{')
                json_end = response_text.rfind('}') + 1
                
                if json_start != -1 and json_end > json_start:
                    response_text = response_text[json_start:json_end]
                else:
                    logger.error(f"No valid JSON found in response: {response_text[:200]}")
                    raise ValueError("No valid JSON structure found in model response")
                
                query_params = json.loads(response_text)
                logger.info(f"Generated DynamoDB query: {query_params}")
                
                # Execute query with agentic correction
                return execute_query_with_correction(query_params, user_prompt)
                
            except Exception as e:
                model_name = getattr(model, 'model_id', getattr(model, 'name', 'unknown'))
                error_type = type(e).__name__
                
                if "ThrottlingException" not in str(e):
                    if "JSONDecodeError" in error_type:
                        logger.error(f"JSON parsing failed with model {model_name}: Invalid response format")
                    else:
                        logger.error(f"Error with model {model_name} ({error_type}): {str(e)}")
                    
                    if attempt == MAX_RETRIES_PER_MODEL - 1:
                        break
                    continue
                
                logger.warning(f"Throttling error with model {model_name}. Attempt {attempt + 1}")
                if attempt < MAX_RETRIES_PER_MODEL - 1:
                    import time
                    time.sleep(RETRY_DELAY)
    
    return {"error": "Failed to generate valid DynamoDB query"}

def fix_query_params(params: Dict[str, Any]) -> Dict[str, Any]:
    """Fix common DynamoDB validation issues"""
    fixed_params = params.copy()
    
    # Fix invalid field names in ProjectionExpression
    if 'ProjectionExpression' in fixed_params:
        projection = fixed_params['ProjectionExpression']
        # Remove invalid field names starting with __
        fields = [f.strip() for f in projection.split(',')]
        valid_fields = [f for f in fields if not f.startswith('__')]
        if valid_fields:
            fixed_params['ProjectionExpression'] = ', '.join(valid_fields)
        else:
            # Remove ProjectionExpression if no valid fields
            del fixed_params['ProjectionExpression']
    
    # Fix KeyConditionExpression with invalid operators
    if 'KeyConditionExpression' in fixed_params:
        key_condition = fixed_params['KeyConditionExpression']
        # Check for invalid operators (IN, OR)
        if ' IN ' in key_condition or ' OR ' in key_condition:
            # Convert to simple equality for first status
            if '#status' in key_condition:
                fixed_params['KeyConditionExpression'] = '#status = :status_val'
                # Ensure we have the right attribute value
                if ':status_val' not in fixed_params.get('ExpressionAttributeValues', {}):
                    # Use first status value found
                    attr_values = fixed_params.get('ExpressionAttributeValues', {})
                    for key, value in attr_values.items():
                        if 'status' in key:
                            fixed_params['ExpressionAttributeValues'][':status_val'] = value
                            break
    
    return fixed_params

def has_multiple_statuses(params: Dict[str, Any]) -> bool:
    """Check if query attempts to filter by multiple status values"""
    key_condition = params.get('KeyConditionExpression', '')
    return ' IN ' in key_condition or ' OR ' in key_condition

def execute_multi_status_query(table, params: Dict[str, Any], user_prompt: str) -> Dict[str, Any]:
    """Execute separate queries for multiple status values and merge results"""
    
    # Extract status values from ExpressionAttributeValues
    attr_values = params.get('ExpressionAttributeValues', {})
    status_values = []
    
    for key, value in attr_values.items():
        if 'status' in key.lower():
            status_values.append(value)
    
    # If no status values found, fall back to common ones
    if not status_values:
        status_values = ['open', 'upcoming']
    
    all_events = []
    
    for status in status_values:
        try:
            # Create query for single status
            single_params = params.copy()
            single_params['KeyConditionExpression'] = '#status = :status_val'
            single_params['ExpressionAttributeValues'] = single_params.get('ExpressionAttributeValues', {}).copy()
            single_params['ExpressionAttributeValues'][':status_val'] = status
            
            # Remove invalid operators from other attribute values
            clean_attr_values = {}
            for key, value in single_params['ExpressionAttributeValues'].items():
                if key == ':status_val' or 'status' not in key.lower():
                    clean_attr_values[key] = value
            single_params['ExpressionAttributeValues'] = clean_attr_values
            
            response = table.query(**single_params)
            all_events.extend(response.get('Items', []))
            
            # Handle pagination
            while 'LastEvaluatedKey' in response and len(all_events) < 5000:
                single_params['ExclusiveStartKey'] = response['LastEvaluatedKey']
                response = table.query(**single_params)
                all_events.extend(response.get('Items', []))
                
        except Exception as e:
            logger.warning(f"Failed to query status '{status}': {str(e)}")
            continue
    
    # Remove duplicates and sort by start_time
    unique_events = []
    seen_keys = set()
    
    for event in all_events:
        event_key = event.get('healthkey', str(event))
        if event_key not in seen_keys:
            seen_keys.add(event_key)
            unique_events.append(event)
    
    # Sort by start_time if available
    try:
        unique_events.sort(key=lambda x: x.get('start_time', ''), reverse=True)
    except:
        pass
    
    return {
        'events': unique_events,
        'count': len(unique_events),
        'query_type': 'multi_status_query'
    }

def convert_to_scan_fallback(table, query_params: Dict[str, Any], user_prompt: str) -> Dict[str, Any]:
    """Convert failed query to simple scan operation"""
    
    try:
        # Extract key terms from user prompt for filtering
        prompt_lower = user_prompt.lower()
        
        # Build basic filter expression
        filter_parts = []
        attr_names = {}
        attr_values = {}
        
        # Add status filters if mentioned
        if 'open' in prompt_lower or 'upcoming' in prompt_lower:
            if 'open' in prompt_lower and 'upcoming' in prompt_lower:
                filter_parts.append("(#status = :open OR #status = :upcoming)")
                attr_values[':open'] = 'open'
                attr_values[':upcoming'] = 'upcoming'
            elif 'open' in prompt_lower:
                filter_parts.append("#status = :open")
                attr_values[':open'] = 'open'
            elif 'upcoming' in prompt_lower:
                filter_parts.append("#status = :upcoming")
                attr_values[':upcoming'] = 'upcoming'
            attr_names['#status'] = 'status_code'
        
        # Add keyword filters
        keywords = []
        if 'security' in prompt_lower:
            keywords.append('security')
        if 'critical' in prompt_lower:
            keywords.append('critical')
        if 'cost' in prompt_lower or 'billing' in prompt_lower or 'financial' in prompt_lower:
            keywords.extend(['cost', 'billing', 'price'])
        if 'ec2' in prompt_lower:
            keywords.append('EC2')
        
        # Add keyword filters to description
        if keywords:
            keyword_filters = []
            for i, keyword in enumerate(keywords[:3]):  # Limit to 3 keywords
                key = f':keyword{i}'
                keyword_filters.append(f"contains(#desc, {key})")
                attr_values[key] = keyword
            
            if keyword_filters:
                filter_parts.append(f"({' OR '.join(keyword_filters)})")
                attr_names['#desc'] = 'description'
        
        # Build scan parameters
        scan_params = {
            'TableName': 'chaplin-health-events'
        }
        
        if filter_parts:
            scan_params['FilterExpression'] = ' AND '.join(filter_parts)
        if attr_names:
            scan_params['ExpressionAttributeNames'] = attr_names
        if attr_values:
            scan_params['ExpressionAttributeValues'] = attr_values
        
        # Execute scan
        response = table.scan(**scan_params)
        events = response.get('Items', [])
        
        # Handle pagination up to 2000 records for scan fallback
        while 'LastEvaluatedKey' in response and len(events) < 2000:
            scan_params['ExclusiveStartKey'] = response['LastEvaluatedKey']
            response = table.scan(**scan_params)
            events.extend(response.get('Items', []))
        
        logger.info(f"Scan fallback retrieved {len(events)} events")
        
        return {
            'events': events,
            'count': len(events),
            'query_type': 'scan_fallback'
        }
        
    except Exception as e:
        logger.error(f"Scan fallback failed: {str(e)}")
        return {
            "error": f"Query execution failed: {str(e)}",
            "fallback_attempted": True
        }

def execute_query_with_correction(query_params: Dict[str, Any], user_prompt: str, max_retries: int = 3) -> Dict[str, Any]:
    """Execute DynamoDB query with agentic error correction"""
    
    dynamodb = boto3.resource('dynamodb', region_name='us-east-1')
    table = dynamodb.Table('chaplin-health-events')
    
    for attempt in range(max_retries):
        try:
            events = []
            
            # Check if this is a structured response with operation_type
            if 'operation_type' in query_params:
                operation_type = query_params['operation_type']
                params = query_params['params']
            else:
                # Legacy format - assume scan
                operation_type = 'scan'
                params = query_params
            
            # Fix common DynamoDB validation issues
            params = fix_query_params(params)
            
            # Handle multi-status queries
            if operation_type == 'query' and has_multiple_statuses(params):
                return execute_multi_status_query(table, params, user_prompt)
            
            if operation_type == 'query':
                # Use GSI query
                response = table.query(**params)
            else:
                # Use table scan
                response = table.scan(**params)
                
            events.extend(response.get('Items', []))
            
            # Handle pagination up to 5000 records
            while 'LastEvaluatedKey' in response and len(events) < 5000:
                params['ExclusiveStartKey'] = response['LastEvaluatedKey']
                if operation_type == 'query':
                    response = table.query(**params)
                else:
                    response = table.scan(**params)
                events.extend(response.get('Items', []))
            
            logger.info(f"Retrieved {len(events)} events from DynamoDB")
            
            # Return appropriate response based on count
            if len(events) >= 5000:
                return {
                    "status": "too_many_results",
                    "message": f"Query returned {len(events)} records, which exceeds the limit. Please refine your query with more specific criteria.",
                    "count": len(events)
                }
            elif len(events) == 0:
                return {
                    "status": "no_data",
                    "message": "No data found matching the query criteria provided.",
                    "count": 0
                }
            elif len(events) <= 100:
                return {
                    "status": "success",
                    "message": f"Found {len(events)} matching records.",
                    "count": len(events),
                    "data": events
                }
            else:  # 100 < count < 5000
                # Summarize the data
                summary = {
                    "total_records": len(events),
                    "services": {},
                    "event_types": {},
                    "status_codes": {},
                    "sample_records": events[:10],
                    "recent_records": sorted(events, key=lambda x: x.get('start_time', ''), reverse=True)[:20]
                }
                
                # Aggregate by key fields
                for event in events:
                    service = event.get('service', 'Unknown')
                    event_type = event.get('event_type', 'Unknown')
                    status = event.get('status_code', 'Unknown')
                    
                    summary["services"][service] = summary["services"].get(service, 0) + 1
                    summary["event_types"][event_type] = summary["event_types"].get(event_type, 0) + 1
                    summary["status_codes"][status] = summary["status_codes"].get(status, 0) + 1
                
                return {
                    "status": "summarized",
                    "message": f"Found {len(events)} records. Data has been summarized for analysis.",
                    "count": len(events),
                    "data": summary
                }
                
        except Exception as e:
            error_message = str(e)
            logger.error(f"DynamoDB query failed (attempt {attempt + 1}): {error_message}")
            
            # Handle validation errors by converting to scan
            if "ValidationException" in error_message and attempt == 0:
                logger.info("Converting invalid query to scan operation...")
                return convert_to_scan_fallback(table, query_params, user_prompt)
            
            if attempt < max_retries - 1:
                # Use LLM to fix the query
                logger.info("Using agentic loop to correct the query...")
                
                correction_prompt = f"""
                The DynamoDB operation failed with this error: {error_message}
                
                Original user request: {user_prompt}
                
                Failed operation: {json.dumps(query_params, indent=2)}
                
                AVAILABLE GSI: status_code-index (Partition Key: status_code, Sort Key: start_time)
                
                Please analyze the error and generate a corrected DynamoDB operation that will work.
                
                Common fixes:
                - For multiple status values, use scan operation instead of query
                - Remove invalid operators (IN, OR) from KeyConditionExpression
                - Ensure all ExpressionAttributeNames used in expressions are defined
                - Remove invalid field names starting with __ from ProjectionExpression
                - Use only field names that exist in the table structure
                - Fix syntax errors in FilterExpression or KeyConditionExpression
                
                Return a JSON object with "operation_type" and "params":
                
                For scan operation:
                {{
                    "operation_type": "scan",
                    "params": {{
                        "FilterExpression": "(#status = :status1 OR #status = :status2) AND contains(#desc, :keyword)",
                        "ExpressionAttributeNames": {{"#status": "status_code", "#desc": "description"}},
                        "ExpressionAttributeValues": {{":status1": "open", ":status2": "upcoming", ":keyword": "security"}}
                    }}
                }}
                
                For GSI query (single status only):
                {{
                    "operation_type": "query",
                    "params": {{
                        "IndexName": "status_code-index",
                        "KeyConditionExpression": "#status = :status_val",
                        "ExpressionAttributeNames": {{"#status": "status_code"}},
                        "ExpressionAttributeValues": {{":status_val": "open"}}
                    }}
                }}

                For table scan:
                {{
                    "operation_type": "scan", 
                    "params": {{
                        "FilterExpression": "contains(#desc, :keyword)",
                        "ExpressionAttributeNames": {{"#desc": "description"}},
                        "ExpressionAttributeValues": {{":keyword": "maintenance"}}
                    }}
                }}
                """
                
                try:
                    for model in MODELS:
                        try:
                            agent = Agent(model=model)
                            correction_response = agent(correction_prompt)
                            
                            # Extract JSON
                            response_text = str(correction_response).strip()
                            json_start = response_text.find('{')
                            json_end = response_text.rfind('}') + 1
                            
                            if json_start != -1 and json_end > json_start:
                                response_text = response_text[json_start:json_end]
                            
                            query_params = json.loads(response_text)
                            logger.info(f"Generated corrected query (attempt {attempt + 2}): {query_params}")
                            break
                            
                        except Exception as model_error:
                            logger.error(f"Model {model.model_id} failed: {str(model_error)}")
                            continue
                    
                except Exception as correction_error:
                    logger.error(f"Failed to generate corrected query: {str(correction_error)}")
                    break
            else:
                return {
                    "status": "error",
                    "message": f"Query execution failed: {error_message}",
                    "count": 0
                }
    
    return {
        "status": "error", 
        "message": "Max retries exceeded, query correction failed",
        "count": 0
    }

if __name__ == "__main__":
    # Test the tool
    test_query = "Show me recent security events for EC2"
    result = build_and_execute_dynamodb_query(test_query)
    print(json.dumps(result, indent=2, default=str))
