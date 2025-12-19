import importlib
import os


def upload_health_on_scheduler_run(event, account_id):
    """Handle scheduled runs for health data collection only"""
    
    # Validate required parameters
    bucket_name = event.get("bucket_name")
    if not bucket_name:
        return {
            "statusCode": 400,
            "body": "Error: bucket_name parameter is missing.",
        }

    past_no_of_days = event.get("past_no_of_days")
    if past_no_of_days is None:
        return {
            "statusCode": 400,
            "body": "Error: past_no_of_days parameter is missing.",
        }

    # Only process health data
    response_messages = []
    
    try:
        bulk_upload_health = importlib.import_module("upload_health")
        response_messages.append("Searching AWS Health notifications...")
        bulk_upload_health.upload_health_events_to_s3(
            bucket_name, past_no_of_days, account_id
        )
        response_messages.append("Health events uploaded successfully.")
        
        return {"statusCode": 200, "body": "\n".join(response_messages)}
        
    except Exception as e:
        error_msg = f"Error uploading health events: {str(e)}"
        print(error_msg)
        return {
            "statusCode": 500,
            "body": error_msg
        }

def lambda_handler(event, context):
    """
    Main Lambda handler for AWS Health Events collection.
    Only processes health data - support cases and Trusted Advisor are not supported.
    """
    account_id = context.invoked_function_arn.split(":")[4]
    
    print(f"Processing health data collection for account: {account_id}")
    print(f"Event: {event}")
    
    return upload_health_on_scheduler_run(event, account_id)
