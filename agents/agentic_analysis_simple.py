import boto3
import json
import logging
import os
from datetime import datetime, timedelta
from typing import Dict, Any, List
from strands import Agent, tool
#from strands_tools import  use_aws
from strands.models.bedrock import BedrockModel
from DBQueryBuilder import build_and_execute_dynamodb_query

# Bypass tool consent
os.environ["BYPASS_TOOL_CONSENT"] = "true"

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize DynamoDB connection
dynamodb = boto3.resource('dynamodb', region_name='us-east-1')
table = dynamodb.Table('chaplin-health-events')

@tool
def analyze_health_events(user_prompt: str) -> str:
    """Analyze AWS Health events based on user query using DynamoDB and LLM"""
    try:
        logger.info(f"Starting analyze_health_events with prompt: {user_prompt[:100]}...")
        
        logger.info("Loading table structure...")
        # Load table structure
        table_info = table.meta.client.describe_table(TableName='chaplin-health-events')
        sample_response = table.scan(Limit=5)
        sample_records = sample_response.get('Items', [])
        logger.info(f"Got {len(sample_records)} sample records")
        
        field_info = {}
        for record in sample_records:
            for key, value in record.items():
                if key not in field_info:
                    field_info[key] = {
                        'type': type(value).__name__,
                        'sample_value': str(value)[:100] if len(str(value)) > 100 else str(value)
                    }
        
        table_structure = {
            'table_name': 'chaplin-health-events',
            'key_schema': table_info['Table']['KeySchema'],
            'attributes': table_info['Table']['AttributeDefinitions'],
            'field_info': field_info,
            'sample_records': sample_records[:2]
        }
        logger.info("Table structure loaded successfully")
        
        # Use DBQueryBuilder for query generation and execution
        logger.info("Using DBQueryBuilder for query execution...")
        result = build_and_execute_dynamodb_query(user_prompt)
        
        # Debug: Check what DBQueryBuilder actually returned
        logger.info(f"DBQueryBuilder returned type: {type(result)}")
        if isinstance(result, str):
            logger.warning("DBQueryBuilder returned string instead of dict - this indicates an error")
            return f"<h3>📊 AWS HEALTH EVENTS ANALYSIS</h3>\n<p>No events found matching your criteria. The health events database does not contain information about EC2 instance utilization rates.</p>"
        
        # Extract events from DBQueryBuilder result format
        events = []
        if isinstance(result, dict):
            # Handle new response formats from fixed DBQueryBuilder
            if 'events' in result:
                # New format: {events: [...], count: N, query_type: "..."}
                events = result['events']
            elif result.get('status') == 'success' and 'data' in result:
                events = result['data']
            elif result.get('status') == 'summarized' and 'data' in result:
                # For summarized data, use the sample and recent records
                summary_data = result['data']
                events = summary_data.get('sample_records', []) + summary_data.get('recent_records', [])
                # Remove duplicates while preserving order
                seen = set()
                unique_events = []
                for event in events:
                    event_id = event.get('healthkey', str(event))
                    if event_id not in seen:
                        seen.add(event_id)
                        unique_events.append(event)
                events = unique_events
            elif result.get('status') == 'too_many_results':
                return f"<h3>📊 AWS HEALTH EVENTS ANALYSIS</h3>\n<p>⚠️ {result.get('message', 'Too many results')}</p>"
            elif result.get('status') == 'no_data':
                return f"<h3>📊 AWS HEALTH EVENTS ANALYSIS</h3>\n<p>No events found matching your criteria.</p>"
            elif 'error' in result:
                return f"<h3>📊 AWS HEALTH EVENTS ANALYSIS</h3>\n<p>⚠️ Query error: {result.get('error', 'Unknown error')}</p>"
            elif result.get('status') == 'error':
                return f"<h3>⚠️ Analysis Error</h3><p>{result.get('message', 'Query execution failed')}</p>"
        elif isinstance(result, list):
            events = result
            
        logger.info(f"Extracted {len(events)} events for analysis")
        
        if len(events) >= 2000:
            return f"<h3>📊 AWS HEALTH EVENTS ANALYSIS</h3>\n<p>⚠️ Query returned {len(events)} records, exceeding limit. Please refine your query.</p>"
        
        if not events:
            return f"<h3>📊 AWS HEALTH EVENTS ANALYSIS</h3>\n<p>No events found matching your criteria.</p>"
        
        # Summarize if too many events
        if len(events) > 50:
            logger.info(f"Summarizing {len(events)} events")
            summary = {
                "total_records": len(events),
                "services": {},
                "event_types": {},
                "status_codes": {},
                "sample_records": events[:10],
                "recent_records": sorted(events, key=lambda x: x.get('start_time', ''), reverse=True)[:20]
            }
            
            for event in events:
                service = event.get('service', 'Unknown')
                event_type = event.get('event_type', 'Unknown')
                status = event.get('status_code', 'Unknown')
                
                summary["services"][service] = summary["services"].get(service, 0) + 1
                summary["event_types"][event_type] = summary["event_types"].get(event_type, 0) + 1
                summary["status_codes"][status] = summary["status_codes"].get(status, 0) + 1
            
            data_for_analysis = summary
        else:
            data_for_analysis = {"full_data": events}
        
        # Generate analysis with retry logic
        logger.info("Generating analysis...")
        analysis_agent = Agent()
        analysis_prompt = f"""
        Analyze AWS Health events for: {user_prompt}
        
        DATA: {json.dumps(data_for_analysis, indent=2, default=str)}
        
        Provide a complete but CONCISE HTML document with:
        1. One summary table showing only the most critical events with CLICKABLE DRILL-DOWN LINKS
        2. Top 2 most relevant insights only
        3. Brief recommendations (maximum 3 bullet points)
        4. One follow-up question
        
        CRITICAL DRILL-DOWN REQUIREMENTS:
        - Each row in your summary table MUST include a clickable link for drill-down
        - Use this exact format for drill-down links: <a href="/drill-down?filters=%7B%22account%22%3A%22ACCOUNT_ID%22%2C%22region%22%3A%22REGION%22%2C%22eventCategory%22%3A%22CATEGORY%22%2C%22service%22%3A%22SERVICE%22%7D" target="_blank" style="color: #007bff; text-decoration: underline;">View Details</a>
        - Replace ACCOUNT_ID, REGION, CATEGORY, SERVICE with actual values from the summary row
        - Include relevant filter criteria based on the summary row data (account, region, eventCategory, service, status_code)
        - The URL encoding is already done in the example above - use this pattern
        
        CRITICAL: Keep response under 2000 characters. Your response must be a complete HTML document starting with <html> and ending with </html>.
        Include minimal CSS styling. Focus on the most important information only.
        Use only HTML tags, no markdown.
        """
        
        # Retry logic for Bedrock API calls
        max_retries = 3
        retry_delay = 2
        analysis_response = None
        
        for attempt in range(max_retries):
            try:
                analysis_response = analysis_agent(analysis_prompt)
                logger.info("Analysis generation completed")
                break
            except Exception as bedrock_error:
                error_msg = str(bedrock_error).lower()
                if 'serviceunavailableexception' in error_msg or 'service unavailable' in error_msg:
                    if attempt < max_retries - 1:
                        logger.warning(f"Bedrock unavailable, retry {attempt + 1}/{max_retries} in {retry_delay}s")
                        import time
                        time.sleep(retry_delay)
                        retry_delay *= 2  # Exponential backoff
                    else:
                        logger.error("Bedrock unavailable after all retries")
                        return """<html>
<head><title>Service Temporarily Unavailable</title></head>
<body>
<h2>⚠️ Service Temporarily Unavailable</h2>
<p>The AI analysis service is currently unavailable. This is a temporary condition.</p>
<p><strong>Please try again in a few moments.</strong></p>
<p>If the issue persists, contact support.</p>
</body>
</html>"""
                else:
                    raise  # Re-raise if not a service unavailable error
        
        # Generate dynamic header
        prompt_lower = user_prompt.lower()
        if any(word in prompt_lower for word in ['cost', 'price', 'billing']):
            header = "💰 COST & FINANCIAL IMPACT ANALYSIS"
        elif any(word in prompt_lower for word in ['security', 'compliance']):
            header = "🔒 SECURITY & COMPLIANCE ANALYSIS"
        elif any(word in prompt_lower for word in ['maintenance', 'scheduled']):
            header = "🔧 MAINTENANCE & OPERATIONAL ANALYSIS"
        else:
            header = "📊 AWS HEALTH EVENTS ANALYSIS"
        
        # Return the analysis response directly - it already contains complete HTML
        logger.info("analyze_health_events completed successfully")
        return str(analysis_response)
        
    except Exception as e:
        logger.error(f"Error in analyze_health_events: {str(e)}", exc_info=True)
        
        # Check for specific error types
        error_str = str(e).lower()
        if 'bedrockmodel' in error_str and 'model_id' in error_str:
            return f"""<html>
<head><title>Model Configuration Error</title></head>
<body>
<h2>🔧 Configuration Issue</h2>
<p><strong>Error:</strong> Bedrock model configuration problem detected.</p>
<p><strong>Details:</strong> The AI model interface has a compatibility issue that needs to be resolved.</p>
<p><strong>Status:</strong> This is a technical issue that should be reported to the development team.</p>
</body>
</html>"""
        
        # Check if this is a data availability issue
        if any(keyword in error_str for keyword in ['utilization', 'reserved instance', 'ec2 instance', 'not contain', 'different table']):
            return f"""<html>
<head><title>Data Availability Notice</title></head>
<body>
<h2>⚠️ Data Not Available</h2>
<p><strong>Query:</strong> {user_prompt[:100]}...</p>
<p><strong>Issue:</strong> The requested information is not available in the current AWS Health Events dataset.</p>
<h3>What We Have:</h3>
<ul>
<li>AWS Health Events and notifications</li>
<li>Service maintenance schedules</li>
<li>Infrastructure lifecycle events</li>
</ul>
<h3>What We Don't Have:</h3>
<ul>
<li>EC2 instance utilization metrics</li>
<li>Reserved instance usage data</li>
<li>Cost and billing information</li>
<li>Performance monitoring data</li>
</ul>
<p><strong>Suggestion:</strong> Please rephrase your query to focus on AWS Health Events, service notifications, or infrastructure changes.</p>
</body>
</html>"""
        else:
            return f"""<html>
<head><title>Analysis Error</title></head>
<body>
<h3>⚠️ Analysis Error</h3>
<p>An error occurred while processing your request: {str(e)}</p>
<p>Please try rephrasing your query or contact support if the issue persists.</p>
</body>
</html>"""

# Create agent with tools
def create_health_analysis_agent():
    """Create agent with health analysis tools"""
    #model = BedrockModel(model_id="anthropic.claude-3-5-sonnet-20241022-v2:0")
    #model = BedrockModel(model_id="us.anthropic.claude-3-5-sonnet-20241022-v2:0", region_name="us-east-1", temperature=0.1)
    model = BedrockModel(model_id="global.anthropic.claude-sonnet-4-20250514-v1:0", region_name="us-east-1", temperature=0.1)
    #model = BedrockModel(model_id="us.meta.llama3-1-70b-instruct-v1:0", region_name="us-east-1", temperature=0.1, stream=False)
    

    system_prompt = """You are an AWS Health Events Analysis expert. 

CRITICAL INSTRUCTIONS:
1. Use the analyze_health_events tool to get analysis data
2. The tool returns complete HTML content - you MUST return this HTML content directly
3. Do NOT generate your own analysis - simply return the tool's HTML output
4. Your response must be the exact HTML content from the tool
5. Do not add any additional text, formatting, or commentary
6. Return only the HTML content that the tool provides
7. If the tool fails or returns an error, you MUST format your response as complete HTML with proper <html> tags
8. NEVER return plain text - ALL responses must be valid HTML documents

For errors or data availability issues, format as:
<html><head><title>Error</title></head><body><h2>Issue Title</h2><p>Description</p></body></html>"""
    
    return Agent(
        system_prompt=system_prompt,
        model=model,
        tools=[analyze_health_events]
    )

def main():
    """Run the agent with input from stdin or use default query"""
    import sys
    
    agent = create_health_analysis_agent()
    
    # Read from stdin if available, otherwise use default
    if not sys.stdin.isatty():
        query = sys.stdin.read().strip()
    else:
        query = "What are the top 5 EC2 events in open status that require immediate attention?"
    
    if query:
        result = agent(query)
        print(result)

if __name__ == "__main__":
    main()
