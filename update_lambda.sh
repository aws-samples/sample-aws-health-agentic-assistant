#!/bin/bash

echo "🔄 Updating Lambda function directly..."

# Get the Lambda function name from CloudFormation stack
LAMBDA_FUNCTION_NAME=$(aws cloudformation describe-stacks \
  --stack-name chaplin-infrastructure-stack \
  --query 'Stacks[0].Outputs[?OutputKey==`S3ToDynamoDBLambdaArn`].OutputValue' \
  --output text | cut -d':' -f7)

if [ -z "$LAMBDA_FUNCTION_NAME" ]; then
  echo "❌ Could not find Lambda function name from CloudFormation stack"
  echo "   Make sure the stack 'chaplin-infrastructure-stack' exists"
  exit 1
fi

echo "📋 Found Lambda function: $LAMBDA_FUNCTION_NAME"

# Create a zip file with the updated code
echo "📦 Creating deployment package..."
zip lambda_deployment.zip lambda_function_updated.py

# Update the Lambda function code
echo "🚀 Updating Lambda function code..."
aws lambda update-function-code \
  --function-name "$LAMBDA_FUNCTION_NAME" \
  --zip-file fileb://lambda_deployment.zip

if [ $? -eq 0 ]; then
  echo "✅ Lambda function updated successfully!"
  echo ""
  echo "🧹 Cleaning up..."
  rm lambda_deployment.zip
  
  echo ""
  echo "📋 Next steps:"
  echo "1. Clear cache: ./clear_cache.sh"
  echo "2. Trigger new health events or wait for next scheduled collection"
  echo "3. Check dashboard for updated Event and ARN fields"
else
  echo "❌ Failed to update Lambda function"
  rm -f lambda_deployment.zip
  exit 1
fi