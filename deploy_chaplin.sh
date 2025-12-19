#!/bin/bash

set -e

echo "=========================================="
echo "Chaplin Deployment Script"
echo "=========================================="
echo ""

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

print_success() { echo -e "${GREEN}✓ $1${NC}"; }
print_error() { echo -e "${RED}✗ $1${NC}"; }
print_info() { echo -e "${YELLOW}ℹ $1${NC}"; }

# Check prerequisites
echo "Checking prerequisites..."

if ! command -v python3 &> /dev/null; then
    print_error "Python 3 is not installed. Please install Python 3.8 or higher."
    exit 1
fi
print_success "Python $(python3 --version | cut -d' ' -f2) found"

if ! command -v node &> /dev/null; then
    print_error "Node.js is not installed. Please install Node.js 16.x or higher."
    exit 1
fi
print_success "Node.js $(node --version) found"

if ! command -v npm &> /dev/null; then
    print_error "npm is not installed."
    exit 1
fi
print_success "npm $(npm --version) found"

if ! command -v aws &> /dev/null; then
    print_error "AWS CLI is not installed."
    exit 1
fi
print_success "AWS CLI found"

echo ""
echo "=========================================="
echo "Configuration"
echo "=========================================="
echo ""

read -p "Enter AWS Region [us-east-1]: " AWS_REGION
AWS_REGION=${AWS_REGION:-us-east-1}
print_info "Using region: $AWS_REGION"

echo ""
read -p "Enter S3 bucket name for health event data (must already exist): " S3_BUCKET_NAME
if [ -z "$S3_BUCKET_NAME" ]; then
    print_error "S3 bucket name is required"
    exit 1
fi

# Verify bucket exists
if ! aws s3 ls "s3://$S3_BUCKET_NAME" --region $AWS_REGION &> /dev/null; then
    print_error "S3 bucket '$S3_BUCKET_NAME' does not exist or is not accessible"
    exit 1
fi
print_success "S3 bucket verified: $S3_BUCKET_NAME"

# Infrastructure setup
echo ""
print_info "AWS Infrastructure Setup"
echo ""
echo "Do you want to:"
echo "1) Deploy new infrastructure (Cognito + DynamoDB) - recommended"
echo "2) Use existing infrastructure"
echo ""
read -p "Enter choice [1]: " INFRA_CHOICE
INFRA_CHOICE=${INFRA_CHOICE:-1}

if [ "$INFRA_CHOICE" == "1" ]; then
    echo ""
    print_info "Deploying Cognito User Pool and DynamoDB Table..."
    
    STACK_NAME="chaplin-infrastructure-stack"
    SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
    
    aws cloudformation deploy \
        --template-file "$SCRIPT_DIR/chaplin-infrastructure.yaml" \
        --stack-name $STACK_NAME \
        --region $AWS_REGION \
        --parameter-overrides HealthDataBucketName=$S3_BUCKET_NAME \
        --capabilities CAPABILITY_NAMED_IAM \
        --no-fail-on-empty-changeset
    
    if [ $? -eq 0 ]; then
        print_success "Infrastructure deployed"
        
        COGNITO_USER_POOL_ID=$(aws cloudformation describe-stacks \
            --stack-name $STACK_NAME \
            --region $AWS_REGION \
            --query 'Stacks[0].Outputs[?OutputKey==`UserPoolId`].OutputValue' \
            --output text)
        
        COGNITO_CLIENT_ID=$(aws cloudformation describe-stacks \
            --stack-name $STACK_NAME \
            --region $AWS_REGION \
            --query 'Stacks[0].Outputs[?OutputKey==`UserPoolClientId`].OutputValue' \
            --output text)
        
        COGNITO_CLIENT_SECRET=$(aws cognito-idp describe-user-pool-client \
            --user-pool-id $COGNITO_USER_POOL_ID \
            --client-id $COGNITO_CLIENT_ID \
            --region $AWS_REGION \
            --query 'UserPoolClient.ClientSecret' \
            --output text)
        
        DYNAMODB_TABLE=$(aws cloudformation describe-stacks \
            --stack-name $STACK_NAME \
            --region $AWS_REGION \
            --query 'Stacks[0].Outputs[?OutputKey==`DynamoDBTableName`].OutputValue' \
            --output text)
        
        LAMBDA_ARN=$(aws cloudformation describe-stacks \
            --stack-name $STACK_NAME \
            --region $AWS_REGION \
            --query 'Stacks[0].Outputs[?OutputKey==`S3ToDynamoDBLambdaArn`].OutputValue' \
            --output text)
        
        print_success "Configuration retrieved"
        print_info "DynamoDB Table: $DYNAMODB_TABLE"
        print_info "Lambda Function: $LAMBDA_ARN"
        
        # Configure S3 event notification
        print_info "Configuring S3 event notification..."
        
        NOTIFICATION_CONFIG=$(cat <<EOF
{
  "LambdaFunctionConfigurations": [
    {
      "LambdaFunctionArn": "$LAMBDA_ARN",
      "Events": ["s3:ObjectCreated:*"],
      "Filter": {
        "Key": {
          "FilterRules": [
            {
              "Name": "suffix",
              "Value": ".json"
            }
          ]
        }
      }
    }
  ]
}
EOF
)
        
        echo "$NOTIFICATION_CONFIG" > /tmp/s3-notification-config.json
        
        if aws s3api put-bucket-notification-configuration \
            --bucket $S3_BUCKET_NAME \
            --notification-configuration file:///tmp/s3-notification-config.json \
            --region $AWS_REGION; then
            print_success "S3 event notification configured"
            rm /tmp/s3-notification-config.json
        else
            print_error "Failed to configure S3 event notification"
            print_info "You may need to configure it manually"
        fi
    else
        print_error "Failed to deploy infrastructure"
        exit 1
    fi
else
    read -p "Enter Cognito User Pool ID: " COGNITO_USER_POOL_ID
    [ -z "$COGNITO_USER_POOL_ID" ] && print_error "User Pool ID required" && exit 1
    
    read -p "Enter Cognito Client ID: " COGNITO_CLIENT_ID
    [ -z "$COGNITO_CLIENT_ID" ] && print_error "Client ID required" && exit 1
    
    read -p "Enter Cognito Client Secret: " COGNITO_CLIENT_SECRET
    [ -z "$COGNITO_CLIENT_SECRET" ] && print_error "Client Secret required" && exit 1
fi

echo ""
echo "=========================================="
echo "Setting up Python environment"
echo "=========================================="
echo ""

if [ ! -d ".venv" ]; then
    print_info "Creating Python virtual environment..."
    python3 -m venv .venv
    print_success "Virtual environment created"
else
    print_info "Virtual environment already exists"
fi

source .venv/bin/activate

print_info "Installing Python dependencies..."
pip install --quiet --upgrade pip
pip install --quiet boto3 pandas numpy python-dotenv

if pip install --quiet strands-agents 2>/dev/null; then
    print_success "Amazon Strands installed"
else
    print_info "Amazon Strands not available (optional)"
fi

print_success "Python dependencies installed"

echo ""
echo "=========================================="
echo "Setting up Node.js dependencies"
echo "=========================================="
echo ""

print_info "Installing server dependencies..."
cd health-dashboard
npm install --silent
print_success "Server dependencies installed"

print_info "Installing client dependencies..."
cd client
npm install --silent
print_success "Client dependencies installed"

print_info "Building React application..."
npm run build --silent
print_success "React application built"
cd ../..

echo ""
echo "=========================================="
echo "Configuring environment"
echo "=========================================="
echo ""

ENV_FILE="health-dashboard/.env"
print_info "Creating environment configuration..."

cat > "$ENV_FILE" << EOF
# AWS Configuration
AWS_REGION=$AWS_REGION

# Bedrock Configuration
BEDROCK_MODEL_ID=global.anthropic.claude-sonnet-4-20250514-v1:0

# AWS Cognito Configuration
COGNITO_USER_POOL_ID=$COGNITO_USER_POOL_ID
COGNITO_CLIENT_ID=$COGNITO_CLIENT_ID
COGNITO_CLIENT_SECRET=$COGNITO_CLIENT_SECRET

# Application Configuration
PORT=3001
NODE_ENV=development
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:3001
EOF

print_success "Environment configuration created"

# Create output directory
print_info "Creating output directory..."
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
mkdir -p "$SCRIPT_DIR/output"
print_success "Output directory created"

echo ""
echo "=========================================="
echo "Verifying AWS access"
echo "=========================================="
echo ""

if aws sts get-caller-identity --region $AWS_REGION &> /dev/null; then
    ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
    print_success "AWS credentials verified (Account: $ACCOUNT_ID)"
else
    print_error "Failed to verify AWS credentials"
    exit 1
fi

print_info "Checking Bedrock model access..."
if aws bedrock list-foundation-models --region $AWS_REGION --query 'modelSummaries[?contains(modelId, `claude-3-5-sonnet`)]' &> /dev/null; then
    print_success "Bedrock access verified"
else
    print_error "Cannot access Bedrock. Ensure Claude 3.5 Sonnet access in $AWS_REGION"
    exit 1
fi

echo ""
echo "=========================================="
echo "Deployment Complete!"
echo "=========================================="
echo ""
print_success "Chaplin has been successfully deployed"
echo ""
if [ "$INFRA_CHOICE" == "1" ]; then
    echo "Infrastructure Details:"
    echo "  User Pool ID: $COGNITO_USER_POOL_ID"
    echo "  Client ID: $COGNITO_CLIENT_ID"
    echo "  DynamoDB Table: $DYNAMODB_TABLE"
    echo ""
    print_info "To create an admin user, run:"
    echo "  aws cognito-idp admin-create-user --user-pool-id $COGNITO_USER_POOL_ID --username admin@example.com --message-action SUPPRESS --region $AWS_REGION && aws cognito-idp admin-set-user-password --user-pool-id $COGNITO_USER_POOL_ID --username admin@example.com --password Admin123! --permanent --region $AWS_REGION"
    echo ""
fi
echo "Next steps:"
echo "1. Deploy the data pipeline: see data_pipeline/README.md"
echo ""
print_info "Starting Chaplin..."
echo ""
echo "Access the application at: http://localhost:3001"
echo "Press Ctrl+C to stop the server"
echo ""
cd health-dashboard && npm start
