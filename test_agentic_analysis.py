#!/usr/bin/env python3

import sys
import os
sys.path.append(os.path.join(os.path.dirname(__file__), 'agents'))

from agentic_analysis_simple import create_health_analysis_agent

def stream_message(message):
    """Stream message to stdout for real-time updates"""
    print(message, flush=True)

def main():
    if len(sys.argv) != 2:
        stream_message("❌ Error: Please provide a query as an argument")
        sys.exit(1)
    
    query = sys.argv[1]
    
    try:
        stream_message("🔍 Analyzing AWS Health events...")
        
        agent = create_health_analysis_agent()
        response = agent(query)
        
        stream_message("✅ Analysis complete!")
        stream_message("")
        stream_message(response)
        sys.stdout.flush()  # Ensure all output is written before exit
        
    except Exception as e:
        error_msg = str(e).lower()
        
        # Check for Bedrock service unavailable
        if 'serviceunavailableexception' in error_msg or 'service unavailable' in error_msg:
            error_html = """<html>
<head><title>Service Temporarily Unavailable</title></head>
<body>
<h2>⚠️ Service Temporarily Unavailable</h2>
<p>The AI analysis service is currently unavailable. This is a temporary condition.</p>
<p><strong>Please try again in a few moments.</strong></p>
</body>
</html>"""
            stream_message(error_html)
        else:
            error_html = f"""<html>
<head><title>Analysis Error</title></head>
<body>
<h2>⚠️ Analysis Error</h2>
<p>An error occurred: {str(e)}</p>
<p>Please try again or contact support if the issue persists.</p>
</body>
</html>"""
            stream_message(error_html)
        
        sys.exit(1)

if __name__ == "__main__":
    main()
