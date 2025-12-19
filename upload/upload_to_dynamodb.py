#!/usr/bin/env python3
import json
import hashlib
import time
import logging
import boto3
from botocore.exceptions import ClientError
import threading
import os

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('upload.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

class DynamoDBUploader:
    def __init__(self, table_name, input_file, progress_file='progress.json'):
        self.table_name = table_name
        self.input_file = input_file
        self.progress_file = progress_file
        self.dynamodb = boto3.resource('dynamodb')
        self.table = self.dynamodb.Table(table_name)
        
        # Counters
        self.processed = 0
        self.skipped = 0
        self.start_index = 0
        
        # Load progress if exists
        self.load_progress()
        
        # Start reporting thread
        self.stop_reporting = False
        self.reporting_thread = threading.Thread(target=self.report_progress)
        self.reporting_thread.daemon = True
        self.reporting_thread.start()

    def load_progress(self):
        """Load progress from file if it exists"""
        if os.path.exists(self.progress_file):
            try:
                with open(self.progress_file, 'r') as f:
                    progress = json.load(f)
                    self.start_index = progress.get('last_processed_index', 0)
                    self.processed = progress.get('processed', 0)
                    self.skipped = progress.get('skipped', 0)
                    logger.info(f"Resuming from index {self.start_index}")
            except Exception as e:
                logger.error(f"Error loading progress: {e}")

    def save_progress(self, index):
        """Save current progress to file"""
        try:
            progress = {
                'last_processed_index': index,
                'processed': self.processed,
                'skipped': self.skipped,
                'timestamp': time.time()
            }
            with open(self.progress_file, 'w') as f:
                json.dump(progress, f)
        except Exception as e:
            logger.error(f"Error saving progress: {e}")

    def generate_hash_key(self, record):
        """Generate unique hash key from record data"""
        record_str = json.dumps(record, sort_keys=True)
        return hashlib.sha256(record_str.encode()).hexdigest()

    def substitute_defaults(self, record):
        """Replace empty/null values with defaults"""
        if not isinstance(record, dict):
            return record
        
        cleaned = {}
        for key, value in record.items():
            if value is None or value == "" or value == {}:
                cleaned[key] = "unknown"
            elif isinstance(value, dict):
                cleaned[key] = self.substitute_defaults(value)
            elif isinstance(value, list):
                cleaned[key] = [self.substitute_defaults(item) if isinstance(item, dict) else (item if item is not None and item != "" else "unknown") for item in value]
            else:
                cleaned[key] = value
        return cleaned

    def get_table_count(self):
        """Get current item count in DynamoDB table"""
        try:
            # Use scan with COUNT to get real-time count
            response = self.table.scan(Select='COUNT')
            return response['Count']
        except Exception as e:
            logger.error(f"Error getting table count: {e}")
            return "unknown"

    def report_progress(self):
        """Report progress every 60 seconds with real-time table count"""
        while not self.stop_reporting:
            time.sleep(60)
            if not self.stop_reporting:
                table_count = self.get_table_count()
                logger.info(f"Progress: Processed={self.processed}, Skipped={self.skipped}, Table Count={table_count}")

    def upload_record(self, record, index):
        """Upload a single record to DynamoDB"""
        try:
            # Clean the record
            cleaned_record = self.substitute_defaults(record)
            
            # Generate hash key
            hash_key = self.generate_hash_key(cleaned_record)
            cleaned_record['healthkey'] = hash_key
            
            # Upload to DynamoDB
            self.table.put_item(Item=cleaned_record)
            self.processed += 1
            
            # Save progress every 100 records
            if self.processed % 100 == 0:
                self.save_progress(index)
                
        except ClientError as e:
            if e.response['Error']['Code'] == 'ConditionalCheckFailedException':
                logger.warning(f"Record {index} already exists, skipping")
                self.skipped += 1
            else:
                logger.error(f"DynamoDB error for record {index}: {e}")
                raise
        except Exception as e:
            logger.error(f"Unexpected error for record {index}: {e}")
            raise

    def upload_data(self):
        """Main upload function"""
        try:
            with open(self.input_file, 'r') as f:
                data = json.load(f)
            
            if not isinstance(data, list):
                logger.error("Input file must contain a JSON array")
                return
            
            total_records = len(data)
            logger.info(f"Starting upload of {total_records} records from index {self.start_index}")
            
            for index in range(self.start_index, total_records):
                try:
                    self.upload_record(data[index], index)
                    
                    # Add smaller delay to avoid throttling
                    time.sleep(0.1)  # Reduced from 0.5 to 0.1 seconds
                    
                except Exception as e:
                    logger.error(f"Failed to process record {index}: {e}")
                    self.save_progress(index)
                    raise
            
            # Final save
            self.save_progress(total_records)
            logger.info(f"Upload completed. Processed: {self.processed}, Skipped: {self.skipped}")
            
        except KeyboardInterrupt:
            logger.info("Upload interrupted by user")
            self.save_progress(index if 'index' in locals() else self.start_index)
        except Exception as e:
            logger.error(f"Upload failed: {e}")
            raise
        finally:
            self.stop_reporting = True
            if self.reporting_thread.is_alive():
                self.reporting_thread.join(timeout=1)

def main():
    uploader = DynamoDBUploader(
        table_name='chaplin-health-events',
        input_file='input.json'
    )
    uploader.upload_data()

if __name__ == "__main__":
    main()
