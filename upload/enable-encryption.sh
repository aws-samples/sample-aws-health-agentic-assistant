#!/bin/bash

# Script to enable AWS-managed KMS encryption on existing DynamoDB table
# and verify the configuration

set -e

TABLE_NAME="chaplin-health-events"
REGION="us-east-1"

echo "🔐 Enabling AWS-Managed KMS Encryption for DynamoDB Table"
echo "=========================================================="
echo ""
echo "Table Name: $TABLE_NAME"
echo "Region: $REGION"
echo ""

# Check if table exists
echo "1️⃣  Checking if table exists..."
if aws dynamodb describe-table --table-name "$TABLE_NAME" --region "$REGION" &> /dev/null; then
    echo "✅ Table '$TABLE_NAME' exists"
else
    echo "❌ Table '$TABLE_NAME' does not exist"
    echo "   Please create the table first using:"
    echo "   aws dynamodb create-table --cli-input-json file://table-config.json --region $REGION"
    exit 1
fi

echo ""

# Check current encryption status
echo "2️⃣  Checking current encryption status..."
CURRENT_SSE=$(aws dynamodb describe-table \
    --table-name "$TABLE_NAME" \
    --region "$REGION" \
    --query 'Table.SSEDescription.Status' \
    --output text 2>/dev/null || echo "NONE")

if [ "$CURRENT_SSE" == "ENABLED" ]; then
    echo "✅ Encryption is already enabled"
    CURRENT_TYPE=$(aws dynamodb describe-table \
        --table-name "$TABLE_NAME" \
        --region "$REGION" \
        --query 'Table.SSEDescription.SSEType' \
        --output text)
    echo "   Current encryption type: $CURRENT_TYPE"
else
    echo "⚠️  Encryption is not enabled"
    echo ""
    
    # Enable encryption
    echo "3️⃣  Enabling AWS-managed KMS encryption..."
    aws dynamodb update-table \
        --table-name "$TABLE_NAME" \
        --sse-specification Enabled=true,SSEType=KMS \
        --region "$REGION"
    
    echo "✅ Encryption update initiated"
    echo "   Waiting for table to become ACTIVE..."
    
    aws dynamodb wait table-exists --table-name "$TABLE_NAME" --region "$REGION"
    
    echo "✅ Table is ACTIVE"
fi

echo ""

# Enable Point-in-Time Recovery
echo "4️⃣  Checking Point-in-Time Recovery status..."
PITR_STATUS=$(aws dynamodb describe-continuous-backups \
    --table-name "$TABLE_NAME" \
    --region "$REGION" \
    --query 'ContinuousBackupsDescription.PointInTimeRecoveryDescription.PointInTimeRecoveryStatus' \
    --output text 2>/dev/null || echo "DISABLED")

if [ "$PITR_STATUS" == "ENABLED" ]; then
    echo "✅ Point-in-Time Recovery is already enabled"
else
    echo "⚠️  Point-in-Time Recovery is not enabled"
    echo "   Enabling PITR..."
    
    aws dynamodb update-continuous-backups \
        --table-name "$TABLE_NAME" \
        --point-in-time-recovery-specification PointInTimeRecoveryEnabled=true \
        --region "$REGION"
    
    echo "✅ Point-in-Time Recovery enabled"
fi

echo ""
echo "=========================================================="
echo "5️⃣  Verification - Current Configuration"
echo "=========================================================="
echo ""

# Get full encryption details
echo "📋 Encryption Details:"
aws dynamodb describe-table \
    --table-name "$TABLE_NAME" \
    --region "$REGION" \
    --query 'Table.SSEDescription' \
    --output table

echo ""
echo "📋 Point-in-Time Recovery Details:"
aws dynamodb describe-continuous-backups \
    --table-name "$TABLE_NAME" \
    --region "$REGION" \
    --query 'ContinuousBackupsDescription.PointInTimeRecoveryDescription' \
    --output table

echo ""
echo "📋 Table Status:"
aws dynamodb describe-table \
    --table-name "$TABLE_NAME" \
    --region "$REGION" \
    --query 'Table.{TableName:TableName,Status:TableStatus,ItemCount:ItemCount,SizeBytes:TableSizeBytes}' \
    --output table

echo ""
echo "=========================================================="
echo "✅ Encryption Configuration Complete!"
echo "=========================================================="
echo ""
echo "Summary:"
echo "  • AWS-Managed KMS encryption: ENABLED"
echo "  • Point-in-Time Recovery: ENABLED"
echo "  • Table Status: ACTIVE"
echo ""
echo "Next Steps:"
echo "  1. Verify encryption in AWS Console"
echo "  2. Update documentation with encryption details"
echo "  3. Test application connectivity"
echo ""
