#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
STACK_NAME="chaplin-health-mcp"
FUNCTION_NAME="chaplin-health-mcp"

print_info() { echo "  $1"; }
print_success() { echo "  $1"; }

echo "============================================"
echo "  Chaplin Health MCP Server - Remote Deploy"
echo "============================================"
echo ""

if [ -z "$AWS_REGION" ]; then
  read -p "AWS Region [us-east-1]: " AWS_REGION
  AWS_REGION="${AWS_REGION:-us-east-1}"
fi

if [ -z "$S3_BUCKET" ]; then
  read -p "S3 bucket for Lambda package (must exist): " S3_BUCKET
  [ -z "$S3_BUCKET" ] && echo "S3 bucket is required" && exit 1
fi

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
S3_KEY="chaplin-mcp/lambda-package.zip"

# --- Step 1: Build Lambda package ---
print_info "Building Lambda deployment package..."
TMPDIR=$(mktemp -d)
mkdir -p "$TMPDIR/src/agents"

# Copy source files
cp "$SCRIPT_DIR/mcp_server.py" "$TMPDIR/src/"
cp "$SCRIPT_DIR/lambda_handler.py" "$TMPDIR/src/"
cp "$SCRIPT_DIR/requirements.txt" "$TMPDIR/src/"
cp "$REPO_DIR/agents/agentic_analysis_simple.py" "$TMPDIR/src/agents/"
cp "$REPO_DIR/agents/DBQueryBuilder.py" "$TMPDIR/src/agents/"
cp "$REPO_DIR/agents/__init__.py" "$TMPDIR/src/agents/"

# Build in Docker with Amazon Linux to get correct native binaries
docker run --rm --platform linux/arm64 -v "$TMPDIR:/build" \
  public.ecr.aws/amazonlinux/amazonlinux:2023 \
  bash -c "
    dnf install -y python3.11 python3.11-pip -q &&
    python3.11 -m pip install -t /build/package -q -r /build/src/requirements.txt &&
    cp /build/src/*.py /build/package/ &&
    cp -r /build/src/agents /build/package/agents &&
    cd /build/package && python3.11 -m zipfile -c /build/lambda-package.zip .
  "
print_success "Lambda package built ($(du -h "$TMPDIR/lambda-package.zip" | cut -f1))"

# --- Step 2: Upload to S3 ---
print_info "Uploading to s3://$S3_BUCKET/$S3_KEY..."
aws s3 cp "$TMPDIR/lambda-package.zip" "s3://$S3_BUCKET/$S3_KEY" --region "$AWS_REGION"
print_success "Package uploaded"

# Cleanup
rm -rf "$TMPDIR"

# --- Step 3: Deploy CloudFormation ---
print_info "Deploying CloudFormation stack: $STACK_NAME..."
aws cloudformation deploy \
  --template-file "$SCRIPT_DIR/chaplin-mcp-infrastructure.yaml" \
  --stack-name "$STACK_NAME" \
  --region "$AWS_REGION" \
  --parameter-overrides \
    S3Bucket="$S3_BUCKET" \
    S3Key="$S3_KEY" \
    AwsRegion="$AWS_REGION" \
  --capabilities CAPABILITY_IAM \
  --no-fail-on-empty-changeset
print_success "CloudFormation stack deployed"

# --- Step 4: Get outputs ---
FUNCTION_URL=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region "$AWS_REGION" \
  --query 'Stacks[0].Outputs[?OutputKey==`FunctionUrl`].OutputValue' \
  --output text)

MCP_ENDPOINT="${FUNCTION_URL}mcp"
FUNCTION_ARN=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region "$AWS_REGION" \
  --query 'Stacks[0].Outputs[?OutputKey==`FunctionArn`].OutputValue' \
  --output text)

# --- Step 5: Update MCP config ---
print_info "Configuring MCP client..."
MCP_CONFIG="$HOME/.kiro/settings/mcp.json"
mkdir -p "$(dirname "$MCP_CONFIG")"

if [ -f "$MCP_CONFIG" ]; then
  python3 -c "
import json
with open('$MCP_CONFIG') as f:
    cfg = json.load(f)
cfg.setdefault('mcpServers', {})['chaplin-health'] = {
    'command': 'uvx',
    'args': [
        'mcp-proxy-for-aws@latest',
        '$MCP_ENDPOINT',
        '--service', 'lambda',
        '--profile', 'default',
        '--region', '$AWS_REGION'
    ]
}
with open('$MCP_CONFIG', 'w') as f:
    json.dump(cfg, f, indent=2)
"
else
  cat > "$MCP_CONFIG" << EOF
{
  "mcpServers": {
    "chaplin-health": {
      "command": "uvx",
      "args": [
        "mcp-proxy-for-aws@latest",
        "$MCP_ENDPOINT",
        "--service", "lambda",
        "--profile", "default",
        "--region", "$AWS_REGION"
      ]
    }
  }
}
EOF
fi

echo ""
echo "============================================"
print_success "Deployment complete!"
echo "============================================"
echo ""
echo "  MCP Endpoint:  $MCP_ENDPOINT"
echo "  Function ARN:  $FUNCTION_ARN"
echo "  Auth:          AWS IAM (SigV4 validated by Lambda Function URL)"
echo ""
echo "Next steps:"
echo "  1. Restart kiro-cli"
echo "  2. Run /mcp to verify chaplin-health is listed"
echo "  3. Try: 'Show me upcoming critical events in the next 30 days'"
echo ""
echo "Grant cross-account access:"
echo "  aws lambda add-permission \\"
echo "    --function-name $FUNCTION_NAME \\"
echo "    --statement-id cross-account-access \\"
echo "    --action lambda:InvokeFunctionUrl \\"
echo "    --principal 'arn:aws:iam::<ACCOUNT_ID>:root' \\"
echo "    --function-url-auth-type AWS_IAM \\"
echo "    --region $AWS_REGION"
echo ""
echo "Cleanup:"
echo "  aws cloudformation delete-stack --stack-name $STACK_NAME --region $AWS_REGION"
