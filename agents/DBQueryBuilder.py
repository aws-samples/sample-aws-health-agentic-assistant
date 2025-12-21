import boto3
import json
import logging
import os
from datetime import datetime
from typing import Dict, Any, List
from strands import Agent, tool
from strands.models.bedrock import BedrockModel

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def load_aws_region():
    """Load AWS region from .env file or environment variable"""
    # First try environment variable
    aws_region = os.getenv('AWS_REGION')
    if aws_region:
        return aws_region
    
    # Try to read from .env file
    env_file_path = os.path.join(os.path.dirname(__file__), '..', 'health-dashboard', '.env')
    if os.path.exists(env_file_path):
        try:
            with open(env_file_path, 'r') as f:
                for line in f:
                    line = line.strip()
                    if line.startswith('AWS_REGION='):
                        aws_region = line.split('=', 1)[1]
                        logger.info(f"Loaded AWS_REGION from .env: {aws_region}")
                        return aws_region
        except Exception as e:
            logger.warning(f"Failed to read .env file: {e}")
    
    # Default fallback
    logger.info("Using default AWS region: us-east-1")
    return 'us-east-1'

# Get AWS region
AWS_REGION = load_aws_region()
logger.info(f"Using AWS region: {AWS_REGION}")

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
        dynamodb = boto3.resource('dynamodb', region_name=AWS_REGION)
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
    
    GSI OPTIMIZATION RULES (CRITICAL):
    1. For single status queries (open, upcoming, closed), ALWAYS use GSI query operation
    2. For multiple status queries, use scan operation with status filters
    3. GSI queries are much more efficient than table scans - prioritize them when possible
    4. Only use scan when GSI cannot be used (no status filter or multiple statuses)

    QUERY STRATEGY PRIORITY:
    1. FIRST CHOICE: GSI query for single status + additional filters
    2. SECOND CHOICE: Optimized scan with specific filters
    3. LAST RESORT: Full table scan

    Rules:
    1. CRITICAL: For single status queries, use GSI query operation with "status_code-index"
    2. For multiple status values (open AND upcoming, open OR upcoming), use scan operation
    3. KeyConditionExpression CANNOT use IN, OR, AND operators - only =, <, >, <=, >=, BETWEEN, begins_with()
    4. Use FilterExpression for additional filtering beyond the key conditions
    5. Use ExpressionAttributeNames for reserved words - ensure ALL names used are defined
    6. Use ExpressionAttributeValues for values - ensure ALL values used are defined
    7. Do NOT include field names starting with __ (like __summary) in any expressions
    8. Only reference field names that exist in the table structure provided
    9. For GSI queries, always include IndexName: "status_code-index"
    10. Prefer exact matches over contains() when possible for better performance
    
    EXAMPLES:

    Single status query (USE GSI - PREFERRED):
    {{
        "operation_type": "query",
        "params": {{
            "IndexName": "status_code-index",
            "KeyConditionExpression": "#status = :status_val",
            "FilterExpression": "#service = :service_val",
            "ExpressionAttributeNames": {{"#status": "status_code", "#service": "service"}},
            "ExpressionAttributeValues": {{":status_val": "open", ":service_val": "S3"}}
        }}
    }}
    
    Multiple status query (USE SCAN):
    {{
        "operation_type": "scan",
        "params": {{
            "FilterExpression": "(#status = :status1 OR #status = :status2) AND #service = :service_val",
            "ExpressionAttributeNames": {{"#status": "status_code", "#service": "service"}},
            "ExpressionAttributeValues": {{":status1": "open", ":status2": "upcoming", ":service_val": "S3"}}
        }}
    }}

    No status filter (USE SCAN):
    {{
        "operation_type": "scan", 
        "params": {{
            "FilterExpression": "#service = :service_val",
            "ExpressionAttributeNames": {{"#service": "service"}},
            "ExpressionAttributeValues": {{":service_val": "EC2"}}
        }}
    }}

    ANALYZE THE USER REQUEST AND CHOOSE THE MOST EFFICIENT OPERATION TYPE.
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
    """Execute separate GSI queries for multiple status values and merge results"""
    
    logger.info("🔄 Executing multi-status GSI query optimization")
    
    # Extract status values from ExpressionAttributeValues
    attr_values = params.get('ExpressionAttributeValues', {})
    status_values = []
    
    for key, value in attr_values.items():
        if 'status' in key.lower():
            status_values.append(value)
    
    # If no status values found, fall back to common ones
    if not status_values:
        status_values = ['open', 'upcoming']
    
    logger.info(f"🚀 Executing separate GSI queries for statuses: {status_values}")
    
    all_events = []
    successful_queries = 0
    
    for status in status_values:
        try:
            # Create optimized GSI query for single status
            single_params = {
                'IndexName': 'status_code-index',
                'KeyConditionExpression': '#status = :status_val',
                'ExpressionAttributeNames': {'#status': 'status_code'},
                'ExpressionAttributeValues': {':status_val': status}
            }
            
            # Add additional filters from original params (excluding status filters)
            original_filter = params.get('FilterExpression', '')
            if original_filter:
                # Remove status-related filters and keep others
                filter_parts = []
                original_attr_names = params.get('ExpressionAttributeNames', {})
                original_attr_values = params.get('ExpressionAttributeValues', {})
                
                # Add non-status filters
                for key, value in original_attr_values.items():
                    if 'status' not in key.lower():
                        # Find corresponding filter expression part
                        if 'service' in key.lower():
                            filter_parts.append(f"#service = {key}")
                            single_params['ExpressionAttributeNames']['#service'] = 'service'
                            single_params['ExpressionAttributeValues'][key] = value
                        elif 'desc' in key.lower() or 'keyword' in key.lower():
                            filter_parts.append(f"contains(#desc, {key})")
                            single_params['ExpressionAttributeNames']['#desc'] = 'description'
                            single_params['ExpressionAttributeValues'][key] = value
                
                if filter_parts:
                    single_params['FilterExpression'] = ' AND '.join(filter_parts)
            
            logger.info(f"🚀 GSI query for status '{status}': {json.dumps(single_params, default=str)}")
            
            response = table.query(**single_params)
            status_events = response.get('Items', [])
            
            # Handle pagination for this status
            page_count = 1
            while 'LastEvaluatedKey' in response and len(status_events) < 1000 and page_count < 10:
                single_params['ExclusiveStartKey'] = response['LastEvaluatedKey']
                response = table.query(**single_params)
                status_events.extend(response.get('Items', []))
                page_count += 1
            
            all_events.extend(status_events)
            successful_queries += 1
            
            logger.info(f"✅ GSI query for status '{status}' completed: {len(status_events)} events in {page_count} pages")
                
        except Exception as e:
            logger.warning(f"❌ GSI query failed for status '{status}': {str(e)}")
            continue
    
    if successful_queries == 0:
        logger.error("❌ All GSI queries failed, falling back to optimized scan")
        return execute_optimized_scan_fallback(table, params, user_prompt)
    
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
    
    logger.info(f"✅ Multi-status GSI query completed: {len(unique_events)} unique events from {successful_queries} successful queries")
    
    return {
        'events': unique_events,
        'count': len(unique_events),
        'query_type': 'multi_status_gsi_query',
        'query_method': f'GSI queries ({successful_queries} successful)'
    }

def execute_optimized_scan_fallback(table, query_params: Dict[str, Any], user_prompt: str) -> Dict[str, Any]:
    """Execute optimized scan operation with better filtering and limits"""
    
    try:
        logger.info("🔄 Executing optimized scan fallback")
        
        # Extract key terms from user prompt for filtering
        prompt_lower = user_prompt.lower()
        
        # Build optimized filter expression
        filter_parts = []
        attr_names = {}
        attr_values = {}
        
        # Add status filters if mentioned (prioritize single status for efficiency)
        status_mentioned = []
        if 'open' in prompt_lower:
            status_mentioned.append('open')
        if 'upcoming' in prompt_lower:
            status_mentioned.append('upcoming')
        if 'closed' in prompt_lower:
            status_mentioned.append('closed')
        
        # Also check for explicit status conditions in the prompt
        import re
        status_pattern = r"status.*?(?:in|=).*?\(([^)]+)\)|status.*?(?:in|=).*?'([^']+)'"
        status_matches = re.findall(status_pattern, prompt_lower)
        for match in status_matches:
            for group in match:
                if group:
                    # Extract status values from patterns like ('upcoming', 'open') or 'open'
                    extracted_statuses = re.findall(r"'([^']+)'", group)
                    for status in extracted_statuses:
                        if status not in status_mentioned:
                            status_mentioned.append(status)
        
        if status_mentioned:
            if len(status_mentioned) == 1:
                # Single status - more efficient
                filter_parts.append("#status = :status")
                attr_values[':status'] = status_mentioned[0]
                logger.info(f"📊 Optimized scan: single status filter = {status_mentioned[0]}")
            else:
                # Multiple statuses
                status_conditions = []
                for i, status in enumerate(status_mentioned):
                    key = f':status{i}'
                    status_conditions.append(f"#status = {key}")
                    attr_values[key] = status
                filter_parts.append(f"({' OR '.join(status_conditions)})")
                logger.info(f"📊 Optimized scan: multi-status filter = {status_mentioned}")
            
            attr_names['#status'] = 'status_code'
        
        # Add service filters
        services = []
        if 's3' in prompt_lower:
            services.append('S3')
        if 'ec2' in prompt_lower:
            services.append('EC2')
        if 'lambda' in prompt_lower:
            services.append('LAMBDA')
        if 'rds' in prompt_lower:
            services.append('RDS')
        
        if services:
            if len(services) == 1:
                filter_parts.append("#service = :service")
                attr_values[':service'] = services[0]
                logger.info(f"📊 Optimized scan: single service filter = {services[0]}")
            else:
                service_conditions = []
                for i, service in enumerate(services):
                    key = f':service{i}'
                    service_conditions.append(f"#service = {key}")
                    attr_values[key] = service
                filter_parts.append(f"({' OR '.join(service_conditions)})")
                logger.info(f"📊 Optimized scan: multi-service filter = {services}")
            
            attr_names['#service'] = 'service'
        
        # Add date-based filters for time-sensitive queries
        date_filters_added = False
        current_time = datetime.now().isoformat() + '+00:00'
        
        # Check for explicit date ranges in the prompt (e.g., "between 2025-08-23 and 2025-12-21")
        date_range_pattern = r"(?:between|from)\s+(\d{4}-\d{2}-\d{2}).*?(?:and|to)\s+(\d{4}-\d{2}-\d{2})"
        date_range_matches = re.findall(date_range_pattern, user_prompt)
        
        if date_range_matches:
            start_date, end_date = date_range_matches[0]
            # Convert to ISO format with time
            start_datetime = f"{start_date}T00:00:00+00:00"
            end_datetime = f"{end_date}T23:59:59+00:00"
            
            filter_parts.append("#start_time BETWEEN :start_date AND :end_date")
            attr_values[':start_date'] = start_datetime
            attr_values[':end_date'] = end_datetime
            attr_names['#start_time'] = 'start_time'
            date_filters_added = True
            logger.info(f"📊 Optimized scan: date range filter ({start_date} to {end_date})")
        
        # Handle general "past due" or overdue events (if no specific date range)
        elif any(term in prompt_lower for term in ['past due', 'overdue', 'expired']):
            filter_parts.append("#start_time < :current_time")
            attr_values[':current_time'] = current_time
            attr_names['#start_time'] = 'start_time'
            date_filters_added = True
            logger.info(f"📊 Optimized scan: past due filter (before {current_time})")
        
        # Handle "upcoming" or future events (if no specific date range)
        elif any(term in prompt_lower for term in ['upcoming', 'next', 'future', 'coming']):
            filter_parts.append("#start_time > :current_time")
            attr_values[':current_time'] = current_time
            attr_names['#start_time'] = 'start_time'
            date_filters_added = True
            logger.info(f"📊 Optimized scan: upcoming filter (after {current_time})")
        
        # Add keyword filters for description (limit to most relevant)
        keywords = []
        if 'security' in prompt_lower:
            keywords.append('security')
        if 'critical' in prompt_lower:
            keywords.append('critical')
        if 'maintenance' in prompt_lower:
            keywords.append('maintenance')
        
        if keywords:
            keyword_filters = []
            for i, keyword in enumerate(keywords[:2]):  # Limit to 2 keywords for efficiency
                key = f':keyword{i}'
                keyword_filters.append(f"contains(#desc, {key})")
                attr_values[key] = keyword
            
            if keyword_filters:
                filter_parts.append(f"({' OR '.join(keyword_filters)})")
                attr_names['#desc'] = 'description'
                logger.info(f"📊 Optimized scan: keyword filters = {keywords[:2]}")
        
        # Build scan parameters
        scan_params = {}
        
        if filter_parts:
            scan_params['FilterExpression'] = ' AND '.join(filter_parts)
        if attr_names:
            scan_params['ExpressionAttributeNames'] = attr_names
        if attr_values:
            scan_params['ExpressionAttributeValues'] = attr_values
        
        # Adjust limits based on whether we have date filters and query type
        if date_filters_added:
            # Date filters are selective, allow more results
            scan_params['Limit'] = 2000
            max_events = 2000
            max_pages = 20
            
            # Special handling for past due events
            if any(term in user_prompt.lower() for term in ['past due', 'overdue', 'past 120 days']):
                max_events = 3000
                max_pages = 30
                logger.info("📊 Past due events scan - allowing up to 3000 records")
        else:
            # No date filters, be more conservative
            scan_params['Limit'] = 1000
            max_events = 1000
            max_pages = 10
        
        logger.info(f"📊 Optimized scan parameters: {json.dumps(scan_params, indent=2, default=str)}")
        
        # Execute scan with controlled pagination
        response = table.scan(**scan_params)
        events = response.get('Items', [])
        
        # Controlled pagination - limit to prevent runaway scans
        page_count = 1
        
        while ('LastEvaluatedKey' in response and 
               len(events) < max_events and 
               page_count < max_pages):
            
            scan_params['ExclusiveStartKey'] = response['LastEvaluatedKey']
            response = table.scan(**scan_params)
            new_items = response.get('Items', [])
            events.extend(new_items)
            page_count += 1
            
            logger.info(f"📊 Optimized scan page {page_count}: +{len(new_items)} items (total: {len(events)})")
        
        if page_count >= max_pages:
            logger.warning(f"⚠️ Scan pagination limit reached ({max_pages} pages)")
        
        logger.info(f"✅ Optimized scan completed: {len(events)} events in {page_count} pages")
        
        return {
            'events': events,
            'count': len(events),
            'query_type': 'optimized_scan',
            'query_method': 'optimized table scan'
        }
        
    except Exception as e:
        logger.error(f"❌ Optimized scan fallback failed: {str(e)}")
        return {
            "error": f"Optimized scan execution failed: {str(e)}",
            "fallback_attempted": True
        }

def attempt_simple_correction(query_params: Dict[str, Any], error_message: str, user_prompt: str) -> Dict[str, Any]:
    """Attempt simple corrections for common DynamoDB errors"""
    
    try:
        logger.info(f"🔧 Attempting simple correction for error: {error_message[:100]}...")
        
        corrected_params = query_params.copy()
        
        # Handle ValidationException errors
        if "ValidationException" in error_message:
            
            # Fix KeyConditionExpression issues
            if "KeyConditionExpression" in error_message:
                if 'params' in corrected_params:
                    params = corrected_params['params']
                    
                    # Remove invalid operators from KeyConditionExpression
                    if 'KeyConditionExpression' in params:
                        key_condition = params['KeyConditionExpression']
                        
                        # Convert multi-value conditions to single value
                        if ' IN ' in key_condition or ' OR ' in key_condition:
                            # Extract first status value
                            attr_values = params.get('ExpressionAttributeValues', {})
                            first_status = None
                            
                            for key, value in attr_values.items():
                                if 'status' in key.lower():
                                    first_status = value
                                    break
                            
                            if first_status:
                                params['KeyConditionExpression'] = '#status = :status_val'
                                params['ExpressionAttributeValues'] = params.get('ExpressionAttributeValues', {})
                                params['ExpressionAttributeValues'][':status_val'] = first_status
                                
                                logger.info(f"✅ Fixed KeyConditionExpression to use single status: {first_status}")
                                return corrected_params
            
            # Fix missing ExpressionAttributeNames
            if "ExpressionAttributeNames" in error_message:
                if 'params' in corrected_params:
                    params = corrected_params['params']
                    
                    # Ensure #status is defined if used
                    if '#status' in str(params) and 'ExpressionAttributeNames' not in params:
                        params['ExpressionAttributeNames'] = {'#status': 'status_code'}
                        logger.info("✅ Added missing ExpressionAttributeNames for #status")
                        return corrected_params
        
        # If no specific correction worked, convert to scan
        logger.info("🔄 No specific correction available, converting to optimized scan")
        return {
            'operation_type': 'scan',
            'params': {
                'FilterExpression': '#status = :status',
                'ExpressionAttributeNames': {'#status': 'status_code'},
                'ExpressionAttributeValues': {':status': 'open'}  # Default to open status
            }
        }
        
    except Exception as e:
        logger.error(f"❌ Simple correction failed: {str(e)}")
        return None

def validate_gsi_query_params(params: Dict[str, Any]) -> bool:
    """Validate that GSI query parameters are correct for status_code-index"""
    try:
        # Check required fields for GSI query
        if 'IndexName' not in params:
            logger.warning("GSI query missing IndexName")
            return False
        
        if params['IndexName'] != 'status_code-index':
            logger.warning(f"Invalid IndexName: {params['IndexName']}")
            return False
        
        if 'KeyConditionExpression' not in params:
            logger.warning("GSI query missing KeyConditionExpression")
            return False
        
        # Check that KeyConditionExpression uses valid operators for GSI
        key_condition = params['KeyConditionExpression']
        
        # Allow valid GSI operators: =, <, <=, >, >=, BETWEEN, begins_with
        invalid_operators = [' IN ', ' OR ']  # Remove AND restriction for sort key conditions
        for op in invalid_operators:
            if op in key_condition:
                logger.warning(f"Invalid operator {op.strip()} in KeyConditionExpression: {key_condition}")
                return False
        
        # Check that required attribute names and values are defined
        if 'ExpressionAttributeNames' in params:
            attr_names = params['ExpressionAttributeNames']
            if '#status' in key_condition and '#status' not in attr_names:
                logger.warning("KeyConditionExpression references #status but it's not defined in ExpressionAttributeNames")
                return False
        
        if 'ExpressionAttributeValues' in params:
            attr_values = params['ExpressionAttributeValues']
            # Check for status value reference
            if ':status' in key_condition:
                status_found = any(':status' in key for key in attr_values.keys())
                if not status_found:
                    logger.warning("KeyConditionExpression references :status but no matching value found")
                    return False
        
        logger.info("✅ GSI query parameters validated successfully")
        return True
        
    except Exception as e:
        logger.error(f"Error validating GSI query parameters: {str(e)}")
        return False

def should_use_gsi_query(user_prompt: str, params: Dict[str, Any]) -> bool:
    """Determine if query should use GSI based on user prompt and parameters"""
    prompt_lower = user_prompt.lower()
    
    # Check if query mentions status-related terms
    status_terms = ['open', 'upcoming', 'closed', 'status']
    has_status_term = any(term in prompt_lower for term in status_terms)
    
    # Check if parameters contain single status filter
    has_single_status = False
    if 'ExpressionAttributeValues' in params:
        status_values = [v for k, v in params['ExpressionAttributeValues'].items() if 'status' in k.lower()]
        has_single_status = len(status_values) == 1
    
    # Check KeyConditionExpression for status equality
    key_condition = params.get('KeyConditionExpression', '')
    has_status_equality = '#status = :' in key_condition and ' OR ' not in key_condition and ' IN ' not in key_condition
    
    should_use = has_status_term and has_single_status and has_status_equality
    
    logger.info(f"🔍 GSI Decision: status_term={has_status_term}, single_status={has_single_status}, status_equality={has_status_equality} → use_gsi={should_use}")
    
    return should_use

def execute_query_with_correction(query_params: Dict[str, Any], user_prompt: str, max_retries: int = 3) -> Dict[str, Any]:
    """Execute DynamoDB query with agentic error correction and GSI optimization"""
    
    dynamodb = boto3.resource('dynamodb', region_name=AWS_REGION)
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
            
            # Enhanced GSI optimization logic
            if operation_type == 'query':
                # Validate GSI parameters before execution
                if not validate_gsi_query_params(params):
                    logger.warning("❌ GSI query validation failed, falling back to optimized scan")
                    return execute_optimized_scan_fallback(table, params, user_prompt)
                
                # Check if we should really use GSI
                if not should_use_gsi_query(user_prompt, params):
                    logger.info("📊 Query not optimal for GSI, using optimized scan instead")
                    return execute_optimized_scan_fallback(table, params, user_prompt)
                
                logger.info("🚀 Executing GSI query on status_code-index")
                
                # Handle multi-status queries by converting to scan
                if has_multiple_statuses(params):
                    logger.info("🔄 Multi-status query detected, converting to optimized scan")
                    return execute_optimized_scan_fallback(table, params, user_prompt)
                
                # Execute GSI query
                response = table.query(**params)
                logger.info(f"✅ GSI query executed successfully, initial batch: {len(response.get('Items', []))} items")
                
            else:
                logger.info("📋 Executing table scan operation")
                response = table.scan(**params)
                logger.info(f"📋 Table scan executed, initial batch: {len(response.get('Items', []))} items")
                
            events.extend(response.get('Items', []))
            
            # Enhanced pagination with better limits and logging
            page_count = 1
            max_pages = 50  # Limit pagination to prevent runaway queries
            
            # Special handling for past due events - allow more records
            if any(term in user_prompt.lower() for term in ['past due', 'overdue', 'past 120 days']):
                max_events = 3000
                logger.info("📊 Past due events query - allowing up to 3000 records")
            else:
                max_events = 2000
            
            while 'LastEvaluatedKey' in response and len(events) < max_events and page_count < max_pages:
                params['ExclusiveStartKey'] = response['LastEvaluatedKey']
                
                if operation_type == 'query':
                    response = table.query(**params)
                    logger.info(f"🚀 GSI query page {page_count + 1}: +{len(response.get('Items', []))} items (total: {len(events)})")
                else:
                    response = table.scan(**params)
                    logger.info(f"📋 Table scan page {page_count + 1}: +{len(response.get('Items', []))} items (total: {len(events)})")
                
                events.extend(response.get('Items', []))
                page_count += 1
            
            # Log final results
            if page_count >= max_pages:
                logger.warning(f"⚠️ Pagination limit reached ({max_pages} pages), results may be incomplete")
            
            operation_desc = "GSI query" if operation_type == 'query' else "table scan"
            logger.info(f"✅ {operation_desc} completed: {len(events)} total events retrieved in {page_count} pages")
            
            # Return appropriate response based on count
            if len(events) >= 2000:
                # Special handling for past due events - they can have more records
                if any(term in user_prompt.lower() for term in ['past due', 'overdue', 'past 120 days']):
                    logger.info("📊 Past due events query detected - allowing higher limit")
                    if len(events) >= 3000:
                        return {
                            "status": "too_many_results",
                            "message": f"Query returned {len(events)} records, which exceeds the limit. Please refine your query with more specific criteria.",
                            "count": len(events),
                            "query_method": operation_desc
                        }
                    else:
                        # Allow past due events up to 3000 records
                        return {
                            "status": "success",
                            "message": f"Found {len(events)} past due events using {operation_desc}.",
                            "count": len(events),
                            "data": events,
                            "query_method": operation_desc
                        }
                else:
                    return {
                        "status": "too_many_results",
                        "message": f"Query returned {len(events)} records, which exceeds the limit. Please refine your query with more specific criteria.",
                        "count": len(events),
                        "query_method": operation_desc
                    }
            elif len(events) == 0:
                return {
                    "status": "no_data",
                    "message": "No data found matching the query criteria provided.",
                    "count": 0,
                    "query_method": operation_desc
                }
            elif len(events) <= 100:
                return {
                    "status": "success",
                    "message": f"Found {len(events)} matching records using {operation_desc}.",
                    "count": len(events),
                    "data": events,
                    "query_method": operation_desc
                }
            else:  # 100 < count < 2000
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
                    "message": f"Found {len(events)} records using {operation_desc}. Data has been summarized for analysis.",
                    "count": len(events),
                    "data": summary,
                    "query_method": operation_desc
                }
                
        except Exception as e:
            error_message = str(e)
            logger.error(f"❌ DynamoDB {operation_type} failed (attempt {attempt + 1}): {error_message}")
            
            # Only fall back to scan on first attempt and for specific errors
            if attempt == 0 and ("ValidationException" in error_message or "ResourceNotFoundException" in error_message):
                logger.info("🔄 Validation error detected, trying optimized scan fallback...")
                return execute_optimized_scan_fallback(table, query_params, user_prompt)
            
            # For other errors, only retry with correction if we have retries left
            if attempt < max_retries - 1:
                logger.info(f"🔧 Attempting query correction (attempt {attempt + 2}/{max_retries})...")
                
                # Simplified correction - try to fix obvious issues
                try:
                    corrected_params = attempt_simple_correction(query_params, error_message, user_prompt)
                    if corrected_params:
                        query_params = corrected_params
                        logger.info("✅ Applied simple correction, retrying...")
                        continue
                except Exception as correction_error:
                    logger.error(f"❌ Simple correction failed: {str(correction_error)}")
                
                # If simple correction fails, fall back to scan
                logger.info("🔄 Falling back to optimized scan...")
                return execute_optimized_scan_fallback(table, query_params, user_prompt)
            else:
                return {
                    "status": "error",
                    "message": f"Query execution failed after {max_retries} attempts: {error_message}",
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
