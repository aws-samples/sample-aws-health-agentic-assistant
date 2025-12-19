#!/bin/bash

# Script to validate table-config.json syntax and encryption configuration

echo "🧪 Testing DynamoDB Table Configuration"
echo "========================================"
echo ""

CONFIG_FILE="upload/table-config.json"

# Check if file exists
if [ ! -f "$CONFIG_FILE" ]; then
    echo "❌ Configuration file not found: $CONFIG_FILE"
    exit 1
fi

echo "✅ Configuration file found"
echo ""

# Validate JSON syntax
echo "1️⃣  Validating JSON syntax..."
if jq empty "$CONFIG_FILE" 2>/dev/null; then
    echo "✅ JSON syntax is valid"
else
    echo "❌ JSON syntax error"
    jq . "$CONFIG_FILE"
    exit 1
fi

echo ""

# Check for required fields
echo "2️⃣  Checking required fields..."

REQUIRED_FIELDS=(
    "TableName"
    "AttributeDefinitions"
    "KeySchema"
    "ProvisionedThroughput"
    "GlobalSecondaryIndexes"
    "BillingMode"
    "SSESpecification"
)

PASSED=0
FAILED=0

for field in "${REQUIRED_FIELDS[@]}"; do
    if jq -e ".$field" "$CONFIG_FILE" > /dev/null 2>&1; then
        echo "   ✅ $field: present"
        ((PASSED++))
    else
        echo "   ❌ $field: missing"
        ((FAILED++))
    fi
done

echo ""

# Check encryption configuration
echo "3️⃣  Checking encryption configuration..."

SSE_ENABLED=$(jq -r '.SSESpecification.Enabled' "$CONFIG_FILE")
SSE_TYPE=$(jq -r '.SSESpecification.SSEType' "$CONFIG_FILE")

if [ "$SSE_ENABLED" == "true" ]; then
    echo "   ✅ SSESpecification.Enabled: true"
    ((PASSED++))
else
    echo "   ❌ SSESpecification.Enabled: $SSE_ENABLED (should be true)"
    ((FAILED++))
fi

if [ "$SSE_TYPE" == "KMS" ]; then
    echo "   ✅ SSESpecification.SSEType: KMS"
    ((PASSED++))
else
    echo "   ❌ SSESpecification.SSEType: $SSE_TYPE (should be KMS)"
    ((FAILED++))
fi

echo ""

# Display encryption configuration
echo "4️⃣  Encryption Configuration:"
jq '.SSESpecification' "$CONFIG_FILE"

echo ""
echo "========================================"
echo "📊 Test Results: $PASSED passed, $FAILED failed"
echo "========================================"
echo ""

if [ $FAILED -eq 0 ]; then
    echo "✅ All configuration tests passed!"
    echo ""
    echo "Configuration Summary:"
    echo "  • Table Name: $(jq -r '.TableName' "$CONFIG_FILE")"
    echo "  • Billing Mode: $(jq -r '.BillingMode' "$CONFIG_FILE")"
    echo "  • Encryption: AWS-Managed KMS"
    echo "  • GSI Count: $(jq '.GlobalSecondaryIndexes | length' "$CONFIG_FILE")"
    echo ""
    exit 0
else
    echo "❌ Some configuration tests failed!"
    echo ""
    exit 1
fi
