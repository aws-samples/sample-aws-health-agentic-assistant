#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
print_success() { echo -e "${GREEN}✓ $1${NC}"; }
print_error() { echo -e "${RED}✗ $1${NC}"; }
print_info() { echo -e "${YELLOW}ℹ $1${NC}"; }

echo "============================================"
echo "  Chaplin - Full Deployment"
echo "============================================"
echo ""

# --- Prerequisites ---
echo "Checking prerequisites..."
command -v python3 &>/dev/null || { print_error "Python 3 required"; exit 1; }
command -v aws &>/dev/null || { print_error "AWS CLI required"; exit 1; }
command -v docker &>/dev/null || { print_error "Docker required (for MCP Lambda build)"; exit 1; }
print_success "Prerequisites OK"

# --- Shared config ---
echo ""
read -p "AWS Region [us-east-1]: " AWS_REGION
AWS_REGION="${AWS_REGION:-us-east-1}"

read -p "S3 bucket for health event data (must exist): " S3_BUCKET_NAME
[ -z "$S3_BUCKET_NAME" ] && print_error "S3 bucket is required" && exit 1

export AWS_REGION S3_BUCKET_NAME

# --- Step 1: Infrastructure ---
echo ""
read -p "Deploy infrastructure (DynamoDB, S3-to-DynamoDB Lambda)? [Y/n]: " DEPLOY_INFRA
DEPLOY_INFRA="${DEPLOY_INFRA:-Y}"

if [[ "$DEPLOY_INFRA" =~ ^[Yy] ]]; then
  echo ""
  echo "============================================"
  echo "  Step 1: Infrastructure"
  echo "============================================"
  echo ""
  source "$SCRIPT_DIR/install-infra.sh"
else
  print_info "Skipping infrastructure deployment"
fi

# --- Step 2: MCP Server ---
echo ""
echo "============================================"
echo "  Step 2: MCP Server (Lambda)"
echo "============================================"
echo ""
# install-remote.sh reads its own prompts; pass S3 bucket via env
export S3_BUCKET="$S3_BUCKET_NAME"
"$SCRIPT_DIR/mcp/install-mcp.sh"

echo ""
echo "============================================"
print_success "Chaplin fully deployed!"
echo "============================================"
echo ""
echo "Next steps:"
echo "  1. Deploy the data pipeline: see data_pipeline/README.md"
echo "  2. Restart kiro-cli and run /mcp to verify chaplin-health is listed"
echo "  3. Try: 'Show me upcoming critical events in the next 30 days'"
echo ""
echo "Optional: Deploy the web dashboard"
echo "  See README_WEB.md for instructions"
