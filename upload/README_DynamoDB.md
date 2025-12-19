# CHAPLIN DynamoDB Setup Guide

## 🔐 Security: Encryption Configuration

**IMPORTANT**: The `chaplin-health-events` table is configured with **AWS-managed KMS encryption** for data protection at rest.

**Quick Start**:
```bash
# Option 1: Create table with encryption (Recommended)
aws cloudformation create-stack \
  --stack-name chaplin-dynamodb-table \
  --template-body file://dynamodb-table.yaml \
  --region us-east-1

# Option 2: Enable encryption on existing table
./enable-encryption.sh

# Verify encryption
./verify-encryption.sh
```

📖 **Full Documentation**: See [ENCRYPTION_CONFIGURATION.md](./ENCRYPTION_CONFIGURATION.md)

---

## Table Configuration

### Primary Table: `chaplin-health-events`

```bash
# Create main table with composite primary key
aws dynamodb create-table \
  --table-name chaplin-health-events \
  --attribute-definitions \
    AttributeName=arn,AttributeType=S \
    AttributeName=account,AttributeType=S \
    AttributeName=service,AttributeType=S \
    AttributeName=event_type,AttributeType=S \
    AttributeName=region,AttributeType=S \
    AttributeName=start_time,AttributeType=S \
    AttributeName=eventCategory,AttributeType=S \
    AttributeName=status_code,AttributeType=S \
    AttributeName=tag,AttributeType=S \
    AttributeName=label,AttributeType=S \
  --key-schema \
    AttributeName=arn,KeyType=HASH \
    AttributeName=account,KeyType=RANGE \
  --provisioned-throughput \
    ReadCapacityUnits=1000,WriteCapacityUnits=500 \
  --global-secondary-indexes \
    IndexName=ServiceIndex,KeySchema=[{AttributeName=service,KeyType=HASH},{AttributeName=start_time,KeyType=RANGE}],Projection={ProjectionType=ALL},ProvisionedThroughput={ReadCapacityUnits=500,WriteCapacityUnits=100} \
    IndexName=EventTypeIndex,KeySchema=[{AttributeName=event_type,KeyType=HASH},{AttributeName=start_time,KeyType=RANGE}],Projection={ProjectionType=ALL},ProvisionedThroughput={ReadCapacityUnits=300,WriteCapacityUnits=50} \
    IndexName=RegionIndex,KeySchema=[{AttributeName=region,KeyType=HASH},{AttributeName=start_time,KeyType=RANGE}],Projection={ProjectionType=ALL},ProvisionedThroughput={ReadCapacityUnits=200,WriteCapacityUnits=50} \
    IndexName=CategoryStatusIndex,KeySchema=[{AttributeName=eventCategory,KeyType=HASH},{AttributeName=status_code,KeyType=RANGE}],Projection={ProjectionType=ALL},ProvisionedThroughput={ReadCapacityUnits=200,WriteCapacityUnits=50} \
    IndexName=TagIndex,KeySchema=[{AttributeName=tag,KeyType=HASH},{AttributeName=start_time,KeyType=RANGE}],Projection={ProjectionType=ALL},ProvisionedThroughput={ReadCapacityUnits=150,WriteCapacityUnits=25} \
    IndexName=LabelIndex,KeySchema=[{AttributeName=label,KeyType=HASH},{AttributeName=start_time,KeyType=RANGE}],Projection={ProjectionType=ALL},ProvisionedThroughput={ReadCapacityUnits=150,WriteCapacityUnits=25} \
  --billing-mode PROVISIONED
```
## Alternatively run table-config.json to create the table chaplin-health-events
aws dynamodb create-table --cli-input-json file://table-config.json
press spacebar and in the END, press q to quit.

# Delete and recreate table (fastest option)
aws dynamodb delete-table --table-name chaplin-health-events

# Wait for deletion to complete
aws dynamodb wait table-not-exists --table-name chaplin-health-events

# Recreate table using your existing script
aws dynamodb create-table --cli-input-json file://table-config.json



## Capacity Planning

### Initial Provisioning (1M records)
- **Main Table**: 1000 RCU / 500 WCU
- **ServiceIndex**: 500 RCU / 100 WCU  
- **EventTypeIndex**: 300 RCU / 50 WCU
- **RegionIndex**: 200 RCU / 50 WCU
- **CategoryStatusIndex**: 200 RCU / 50 WCU
- **TagIndex**: 150 RCU / 25 WCU
- **LabelIndex**: 150 RCU / 25 WCU

### Auto Scaling Configuration

```bash
# Enable auto scaling for main table
aws application-autoscaling register-scalable-target \
  --service-namespace dynamodb \
  --resource-id table/chaplin-health-events \
  --scalable-dimension dynamodb:table:ReadCapacityUnits \
  --min-capacity 100 \
  --max-capacity 4000

aws application-autoscaling register-scalable-target \
  --service-namespace dynamodb \
  --resource-id table/chaplin-health-events \
  --scalable-dimension dynamodb:table:WriteCapacityUnits \
  --min-capacity 50 \
  --max-capacity 2000

# Create scaling policies
aws application-autoscaling put-scaling-policy \
  --service-namespace dynamodb \
  --resource-id table/chaplin-health-events \
  --scalable-dimension dynamodb:table:ReadCapacityUnits \
  --policy-name ReadScalingPolicy \
  --policy-type TargetTrackingScaling \
  --target-tracking-scaling-policy-configuration '{
    "TargetValue": 70.0,
    "PredefinedMetricSpecification": {
      "PredefinedMetricType": "DynamoDBReadCapacityUtilization"
    }
  }'
```

## Data Upload Script

```python
#!/usr/bin/env python3
import json
import boto3
import time
import threading
from boto3.dynamodb.conditions import Key
from decimal import Decimal
from datetime import datetime

CONFIG_FILE = 'upload_progress.json'

def load_progress():
    """Load upload progress from config file"""
    try:
        with open(CONFIG_FILE, 'r') as f:
            return json.load(f)
    except FileNotFoundError:
        return {'last_processed_index': 0, 'total_processed': 0, 'total_skipped': 0}

def save_progress(progress):
    """Save upload progress to config file"""
    with open(CONFIG_FILE, 'w') as f:
        json.dump(progress, f, indent=2)

def classify_environment(account_name):
    """Determine environment from account name"""
    if not account_name:
        return 'Unknown'
    
    name_lower = account_name.lower()
    prod_patterns = ['prod', 'production', 'live', 'prd']
    non_prod_patterns = ['dev', 'test', 'staging', 'lab', 'sandbox', 'demo', 'qa']
    
    if any(pattern in name_lower for pattern in prod_patterns):
        return 'Prod'
    elif any(pattern in name_lower for pattern in non_prod_patterns):
        return 'Non-Prod'
    else:
        return 'Unknown'

def convert_decimals(obj):
    """Convert floats to Decimal for DynamoDB"""
    if isinstance(obj, float):
        return Decimal(str(obj))
    elif isinstance(obj, dict):
        return {k: convert_decimals(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [convert_decimals(v) for v in obj]
    return obj

def enhance_event(event):
    """Add custom attributes to event"""
    event['tag'] = classify_environment(event.get('name', ''))
    event['label'] = ''  # Empty for now
    return event

def get_table_count(table):
    """Get current item count in DynamoDB table"""
    try:
        response = table.describe_table()
        return response['Table']['ItemCount']
    except:
        return 0

def display_stats(progress, table, total_events, stop_event):
    """Display statistics every 30 seconds"""
    while not stop_event.is_set():
        table_count = get_table_count(table)
        print(f"\n📊 [{datetime.now().strftime('%H:%M:%S')}] Progress Update:")
        print(f"   • Records Processed: {progress['total_processed']:,}")
        print(f"   • Records Skipped: {progress['total_skipped']:,}")
        print(f"   • Total in Table: {table_count:,}")
        print(f"   • Remaining: {total_events - progress['last_processed_index']:,}")
        
        stop_event.wait(30)  # Wait 30 seconds or until stop signal

def upload_health_events():
    dynamodb = boto3.resource('dynamodb')
    table = dynamodb.Table('chaplin-health-events')
    
    # Load events and progress
    with open('input_orig_1m.json', 'r') as f:
        events = json.load(f)
    
    progress = load_progress()
    start_index = progress['last_processed_index']
    
    print(f"🚀 Starting upload from index {start_index:,} of {len(events):,} events")
    
    # Start statistics display thread
    stop_stats = threading.Event()
    stats_thread = threading.Thread(
        target=display_stats, 
        args=(progress, table, len(events), stop_stats)
    )
    stats_thread.daemon = True
    stats_thread.start()
    
    try:
        batch_size = 25
        for i in range(start_index, len(events), batch_size):
            batch = events[i:i + batch_size]
            
            with table.batch_writer() as writer:
                for event in batch:
                    try:
                        enhanced_event = enhance_event(event.copy())
                        writer.put_item(Item=convert_decimals(enhanced_event))
                        progress['total_processed'] += 1
                    except Exception as e:
                        print(f"⚠️  Skipped event at index {i}: {e}")
                        progress['total_skipped'] += 1
            
            # Update progress
            progress['last_processed_index'] = i + len(batch)
            
            # Save progress every 1000 records
            if i % 1000 == 0:
                save_progress(progress)
        
        # Final save
        save_progress(progress)
        stop_stats.set()
        
        print(f"\n✅ Upload complete!")
        print(f"   • Total Processed: {progress['total_processed']:,}")
        print(f"   • Total Skipped: {progress['total_skipped']:,}")
        
    except KeyboardInterrupt:
        print(f"\n⏸️  Upload paused at index {progress['last_processed_index']:,}")
        save_progress(progress)
        stop_stats.set()
    except Exception as e:
        print(f"\n❌ Upload failed: {e}")
        save_progress(progress)
        stop_stats.set()

if __name__ == "__main__":
    upload_health_events()
```

## Query Patterns

### Agent-Specific Queries

```python
# PLE Agent - Query by event type
response = table.query(
    IndexName='EventTypeIndex',
    KeyConditionExpression=Key('event_type').eq('PLANNED_LIFECYCLE_EVENT')
)

# Infrastructure Agent - Query by service
response = table.query(
    IndexName='ServiceIndex',
    KeyConditionExpression=Key('service').eq('EC2')
)

# Regional queries
response = table.query(
    IndexName='RegionIndex',
    KeyConditionExpression=Key('region').eq('us-east-1')
)

# Environment-based queries
response = table.query(
    IndexName='TagIndex',
    KeyConditionExpression=Key('tag').eq('Production')
)

# Priority-based queries
response = table.query(
    IndexName='LabelIndex',
    KeyConditionExpression=Key('label').eq('Critical')
)

# Category and status queries
response = table.query(
    IndexName='CategoryStatusIndex',
    KeyConditionExpression=Key('eventCategory').eq('scheduledChange') & Key('status_code').eq('upcoming')
)
```

## Performance Optimizations

### 1. Parallel Scanning
```python
def parallel_scan(table, segment_count=4):
    threads = []
    results = []
    
    for segment in range(segment_count):
        thread = threading.Thread(
            target=scan_segment,
            args=(table, segment, segment_count, results)
        )
        threads.append(thread)
        thread.start()
    
    for thread in threads:
        thread.join()
    
    return results
```

### 2. Connection Pooling
```python
# Configure boto3 for high throughput
import boto3
from botocore.config import Config

config = Config(
    max_pool_connections=50,
    retries={'max_attempts': 3}
)

dynamodb = boto3.resource('dynamodb', config=config)
```

## Cost Optimization

### On-Demand Alternative
```bash
# Switch to on-demand for unpredictable workloads
aws dynamodb modify-table \
  --table-name chaplin-health-events \
  --billing-mode PAY_PER_REQUEST
```

### Reserved Capacity
- Purchase reserved capacity for predictable workloads
- 53% savings for 1-year term
- 76% savings for 3-year term

## Monitoring

### CloudWatch Metrics
- `ConsumedReadCapacityUnits`
- `ConsumedWriteCapacityUnits` 
- `ThrottledRequests`
- `SuccessfulRequestLatency`

### Alarms
```bash
aws cloudwatch put-metric-alarm \
  --alarm-name "DynamoDB-HighReadThrottle" \
  --alarm-description "High read throttling" \
  --metric-name ThrottledRequests \
  --namespace AWS/DynamoDB \
  --statistic Sum \
  --period 300 \
  --threshold 10 \
  --comparison-operator GreaterThanThreshold
```

## Migration Commands

```bash
# 1. Create table
aws dynamodb create-table --cli-input-json file://table-config.json

# 2. Upload data (resumable)
python3 upload_to_dynamodb.py

# 3. Check progress (if interrupted)
cat upload_progress.json

# 4. Resume upload (automatically starts from last position)
python3 upload_to_dynamodb.py

# 5. Verify data
aws dynamodb describe-table --table-name chaplin-health-events

# 6. Test queries
python3 test_queries.py
```

## Expected Performance
- **Scan 1M records**: ~30 seconds (parallel)
- **Query by service**: <100ms
- **Query by event_type**: <100ms
- **Point lookup**: <10ms
- **Batch operations**: 25 items/request

## Estimated Costs (us-east-1)
- **Provisioned**: ~$400/month (1000 RCU + 500 WCU)
- **On-Demand**: ~$200-800/month (usage dependent)
- **Storage**: ~$25/month (1M records ≈ 100GB)