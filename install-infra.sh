#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STACK_NAME="chaplin-infrastructure-stack"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
print_success() { echo -e "${GREEN}✓ $1${NC}"; }
print_error() { echo -e "${RED}✗ $1${NC}"; }
print_info() { echo -e "${YELLOW}ℹ $1${NC}"; }

echo "============================================"
echo "  Chaplin Infrastructure Deployment"
echo "============================================"
echo ""

# Accept params from parent script or prompt
AWS_REGION="${AWS_REGION:-}"
S3_BUCKET_NAME="${S3_BUCKET_NAME:-}"

if [ -z "$AWS_REGION" ]; then
  read -p "AWS Region [us-east-1]: " AWS_REGION
  AWS_REGION="${AWS_REGION:-us-east-1}"
fi

if [ -z "$S3_BUCKET_NAME" ]; then
  read -p "S3 bucket for health event data (must exist): " S3_BUCKET_NAME
  [ -z "$S3_BUCKET_NAME" ] && print_error "S3 bucket is required" && exit 1
fi

# Verify bucket
if ! aws s3 ls "s3://$S3_BUCKET_NAME" --region "$AWS_REGION" &>/dev/null; then
  print_error "S3 bucket '$S3_BUCKET_NAME' does not exist or is not accessible"
  exit 1
fi
print_success "S3 bucket verified: $S3_BUCKET_NAME"

# --- Deploy CloudFormation ---
print_info "Deploying CloudFormation stack: $STACK_NAME..."

aws cloudformation deploy \
  --template-file "$SCRIPT_DIR/chaplin-infrastructure.yaml" \
  --stack-name "$STACK_NAME" \
  --region "$AWS_REGION" \
  --parameter-overrides HealthDataBucketName="$S3_BUCKET_NAME" \
  --capabilities CAPABILITY_NAMED_IAM \
  --no-fail-on-empty-changeset

print_success "Infrastructure deployed"

# --- Get outputs ---
DYNAMODB_TABLE=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$AWS_REGION" \
  --query 'Stacks[0].Outputs[?OutputKey==`DynamoDBTableName`].OutputValue' --output text)
LAMBDA_ARN=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$AWS_REGION" \
  --query 'Stacks[0].Outputs[?OutputKey==`S3ToDynamoDBLambdaArn`].OutputValue' --output text)
METADATA_LAMBDA_ARN=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$AWS_REGION" \
  --query 'Stacks[0].Outputs[?OutputKey==`MetadataIngestionLambdaArn`].OutputValue' --output text)

print_info "DynamoDB Table: $DYNAMODB_TABLE"
print_info "S3-to-DynamoDB Lambda: $LAMBDA_ARN"
print_info "Metadata Ingestion Lambda: $METADATA_LAMBDA_ARN"

# --- S3 event notification ---
print_info "Configuring S3 event notifications..."

cat > /tmp/s3-notification-config.json << EOF
{
  "LambdaFunctionConfigurations": [
    {
      "LambdaFunctionArn": "$LAMBDA_ARN",
      "Events": ["s3:ObjectCreated:*"],
      "Filter": {
        "Key": {
          "FilterRules": [
            {"Name": "prefix", "Value": "health/"},
            {"Name": "suffix", "Value": ".json"}
          ]
        }
      }
    },
    {
      "LambdaFunctionArn": "$METADATA_LAMBDA_ARN",
      "Events": ["s3:ObjectCreated:*"],
      "Filter": {
        "Key": {
          "FilterRules": [
            {"Name": "prefix", "Value": "account-metadata/"},
            {"Name": "suffix", "Value": ".json"}
          ]
        }
      }
    }
  ]
}
EOF

if aws s3api put-bucket-notification-configuration \
    --bucket "$S3_BUCKET_NAME" \
    --notification-configuration file:///tmp/s3-notification-config.json \
    --region "$AWS_REGION"; then
  print_success "S3 event notification configured"
else
  print_error "Failed to configure S3 event notification (configure manually)"
fi
rm -f /tmp/s3-notification-config.json

# --- Export for parent script ---
export AWS_REGION S3_BUCKET_NAME DYNAMODB_TABLE

echo ""
echo "============================================"
print_success "Infrastructure deployment complete!"
echo "============================================"
echo ""
echo "  DynamoDB Table (health events): $DYNAMODB_TABLE"
echo "  DynamoDB Table (account metadata): chaplin-account-metadata"
echo "  S3 Bucket:      $S3_BUCKET_NAME"
echo ""
echo "  Note: Cognito is only needed for the web dashboard."
echo "  See deploy_chaplin_web.sh or README_WEB.md for web setup."
echo ""
echo "Cleanup:"
echo "  aws cloudformation delete-stack --stack-name $STACK_NAME --region $AWS_REGION"
