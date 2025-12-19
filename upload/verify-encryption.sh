#!/bin/bash

# Script to verify DynamoDB table encryption configuration

TABLE_NAME="chaplin-health-events"
REGION="us-east-1"

echo "🔍 Verifying DynamoDB Encryption Configuration"
echo "=============================================="
echo ""

# Check if AWS CLI is configured
if ! aws sts get-caller-identity &> /dev/null; then
    echo "❌ AWS CLI is not configured or credentials are invalid"
    echo "   Please configure AWS CLI with: aws configure"
    exit 1
fi

echo "✅ AWS CLI is configured"
echo ""

# Check if table exists
echo "Checking table: $TABLE_NAME"
echo "Region: $REGION"
echo ""

if ! aws dynamodb describe-table --table-name "$TABLE_NAME" --region "$REGION" &> /dev/null; then
    echo "❌ Table '$TABLE_NAME' does not exist in region $REGION"
    echo ""
    echo "To create the table with encryption:"
    echo "  Option 1: Using CloudFormation (Recommended)"
    echo "    aws cloudformation create-stack \\"
    echo "      --stack-name chaplin-dynamodb-table \\"
    echo "      --template-body file://upload/dynamodb-table.yaml \\"
    echo "      --region $REGION"
    echo ""
    echo "  Option 2: Using AWS CLI"
    echo "    aws dynamodb create-table \\"
    echo "      --cli-input-json file://upload/table-config.json \\"
    echo "      --region $REGION"
    exit 1
fi

echo "✅ Table exists"
echo ""

# Validation checks
PASSED=0
FAILED=0

echo "Running Security Checks..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Check 1: Encryption Status
echo "1. Encryption Status"
SSE_STATUS=$(aws dynamodb describe-table \
    --table-name "$TABLE_NAME" \
    --region "$REGION" \
    --query 'Table.SSEDescription.Status' \
    --output text 2>/dev/null || echo "NONE")

if [ "$SSE_STATUS" == "ENABLED" ]; then
    echo "   ✅ PASS - Encryption is enabled"
    ((PASSED++))
else
    echo "   ❌ FAIL - Encryption is not enabled"
    ((FAILED++))
fi

# Check 2: Encryption Type
echo "2. Encryption Type"
SSE_TYPE=$(aws dynamodb describe-table \
    --table-name "$TABLE_NAME" \
    --region "$REGION" \
    --query 'Table.SSEDescription.SSEType' \
    --output text 2>/dev/null || echo "NONE")

if [ "$SSE_TYPE" == "KMS" ]; then
    echo "   ✅ PASS - Using KMS encryption"
    ((PASSED++))
else
    echo "   ❌ FAIL - Not using KMS encryption (Current: $SSE_TYPE)"
    ((FAILED++))
fi

# Check 3: Point-in-Time Recovery
echo "3. Point-in-Time Recovery"
PITR_STATUS=$(aws dynamodb describe-continuous-backups \
    --table-name "$TABLE_NAME" \
    --region "$REGION" \
    --query 'ContinuousBackupsDescription.PointInTimeRecoveryDescription.PointInTimeRecoveryStatus' \
    --output text 2>/dev/null || echo "DISABLED")

if [ "$PITR_STATUS" == "ENABLED" ]; then
    echo "   ✅ PASS - Point-in-Time Recovery is enabled"
    ((PASSED++))
else
    echo "   ⚠️  WARN - Point-in-Time Recovery is not enabled (Recommended)"
fi

# Check 4: Table Status
echo "4. Table Status"
TABLE_STATUS=$(aws dynamodb describe-table \
    --table-name "$TABLE_NAME" \
    --region "$REGION" \
    --query 'Table.TableStatus' \
    --output text)

if [ "$TABLE_STATUS" == "ACTIVE" ]; then
    echo "   ✅ PASS - Table is ACTIVE"
    ((PASSED++))
else
    echo "   ⚠️  WARN - Table status: $TABLE_STATUS"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📊 Test Results: $PASSED passed, $FAILED failed"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

if [ $FAILED -eq 0 ]; then
    echo "✅ All critical security checks passed!"
    echo ""
    echo "Encryption Details:"
    aws dynamodb describe-table \
        --table-name "$TABLE_NAME" \
        --region "$REGION" \
        --query 'Table.SSEDescription' \
        --output json
    echo ""
    exit 0
else
    echo "❌ Some security checks failed!"
    echo ""
    echo "To fix encryption issues, run:"
    echo "  ./upload/enable-encryption.sh"
    echo ""
    exit 1
fi
