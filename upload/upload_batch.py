#!/usr/bin/env python3
import json
import hashlib
import time
import logging
import boto3
from botocore.exceptions import ClientError
import threading
import os

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class BatchDynamoDBUploader:
    def __init__(self, table_name, input_file, batch_size=25, progress_file='progress.json'):
        self.table_name = table_name
        self.input_file = input_file
        self.batch_size = batch_size
        self.progress_file = progress_file
        self.dynamodb = boto3.resource('dynamodb')
        self.table = self.dynamodb.Table(table_name)
        self.processed = 0
        self.skipped = 0
        self.start_index = 0
        
        # Load progress from existing file
        self.load_progress()

    def load_progress(self):
        """Load progress from existing progress.json file"""
        if os.path.exists(self.progress_file):
            try:
                with open(self.progress_file, 'r') as f:
                    progress = json.load(f)
                    self.start_index = progress.get('last_processed_index', 0)
                    self.processed = progress.get('processed', 0)
                    self.skipped = progress.get('skipped', 0)
                    logger.info(f"Resuming from index {self.start_index}, already processed {self.processed} records")
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

    def substitute_defaults(self, record):
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

    def generate_hash_key(self, record):
        record_str = json.dumps(record, sort_keys=True)
        return hashlib.sha256(record_str.encode()).hexdigest()

    def upload_batch(self, batch, batch_start_index):
        try:
            with self.table.batch_writer() as batch_writer:
                for record in batch:
                    cleaned_record = self.substitute_defaults(record)
                    cleaned_record['healthkey'] = self.generate_hash_key(cleaned_record)
                    batch_writer.put_item(Item=cleaned_record)
            self.processed += len(batch)
            self.save_progress(batch_start_index + len(batch))
            logger.info(f"Uploaded batch of {len(batch)} records. Total processed: {self.processed}")
        except Exception as e:
            logger.error(f"Batch upload failed: {e}")
            raise

    def upload_data(self):
        with open(self.input_file, 'r') as f:
            data = json.load(f)
        
        total_records = len(data)
        remaining_records = total_records - self.start_index
        logger.info(f"Starting batch upload from index {self.start_index}. Remaining: {remaining_records} records")
        
        for i in range(self.start_index, total_records, self.batch_size):
            batch = data[i:i + self.batch_size]
            self.upload_batch(batch, i)
            time.sleep(0.1)  # Small delay between batches
        
        logger.info(f"Upload completed. Total processed: {self.processed}")

def main():
    uploader = BatchDynamoDBUploader('chaplin-health-events', 'input.json')
    uploader.upload_data()

if __name__ == "__main__":
    main()
