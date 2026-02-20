#!/bin/bash
set -e

echo "=========================================="
echo "Chaplin EC2 Deployment Script (CFN)"
echo "=========================================="
echo ""

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'
print_success() { echo -e "${GREEN}✓ $1${NC}"; }
print_error() { echo -e "${RED}✗ $1${NC}"; }
print_info() { echo -e "${YELLOW}ℹ $1${NC}"; }

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
APP_PORT=3001

# ==========================================
# Configuration (update these as needed)
# ==========================================
INSTANCE_TYPE="t3.medium"

# ==========================================
# Prerequisites
# ==========================================

for cmd in aws curl; do
    if ! command -v $cmd &>/dev/null; then
        print_error "$cmd is required but not installed"; exit 1
    fi
done
print_success "Prerequisites OK"

# ==========================================
# Gather inputs
# ==========================================

read -p "Enter AWS Region (default: us-east-1): " AWS_REGION
AWS_REGION=${AWS_REGION:-us-east-1}
EC2_STACK_NAME="chaplin-ec2-${AWS_REGION}"

read -p "Enter S3 bucket name for health event data (must already exist): " S3_BUCKET_NAME
if [ -z "$S3_BUCKET_NAME" ]; then
    print_error "S3 bucket name is required"; exit 1
fi
if ! aws s3 ls "s3://$S3_BUCKET_NAME" --region "$AWS_REGION" &>/dev/null; then
    print_error "S3 bucket '$S3_BUCKET_NAME' does not exist or is not accessible"; exit 1
fi
print_success "S3 bucket verified: $S3_BUCKET_NAME"

read -p "Enter Cognito user email: " COGNITO_USER_EMAIL
if [ -z "$COGNITO_USER_EMAIL" ]; then
    print_error "Email is required"; exit 1
fi

# Extract domain and ask about restriction
EMAIL_DOMAIN="${COGNITO_USER_EMAIL#*@}"
read -p "Restrict signups to @${EMAIL_DOMAIN} only? [Y/n]: " RESTRICT_DOMAIN
RESTRICT_DOMAIN=${RESTRICT_DOMAIN:-Y}
if [[ "$RESTRICT_DOMAIN" =~ ^[Yy] ]]; then
    ALLOWED_EMAIL_DOMAIN="$EMAIL_DOMAIN"
    print_success "Signups restricted to @${EMAIL_DOMAIN}"
else
    ALLOWED_EMAIL_DOMAIN=""
    print_info "Signups open to any email domain"
fi

print_info "Instance type: $INSTANCE_TYPE"

# ==========================================
# Detect client public IP
# ==========================================

print_info "Detecting your public IP..."
CLIENT_IP=$(curl -s --max-time 10 https://checkip.amazonaws.com | tr -d '[:space:]')
if [ -z "$CLIENT_IP" ]; then
    print_error "Could not detect public IP"; exit 1
fi
print_success "Client IP: $CLIENT_IP"

# ==========================================
# Lookup AMI, VPC, Subnet
# ==========================================

print_info "Looking up latest Amazon Linux 2023 AMI..."
AMI_ID=$(aws ec2 describe-images --region "$AWS_REGION" \
    --owners amazon \
    --filters "Name=name,Values=al2023-ami-2023*-x86_64" "Name=state,Values=available" \
    --query 'sort_by(Images, &CreationDate)[-1].ImageId' --output text)
if [ -z "$AMI_ID" ] || [ "$AMI_ID" == "None" ]; then
    print_error "Could not find Amazon Linux 2023 AMI"; exit 1
fi
print_success "AMI: $AMI_ID"

VPC_ID=$(aws ec2 describe-vpcs --region "$AWS_REGION" \
    --filters "Name=isDefault,Values=true" \
    --query 'Vpcs[0].VpcId' --output text)
if [ -z "$VPC_ID" ] || [ "$VPC_ID" == "None" ]; then
    print_error "No default VPC found"; exit 1
fi

# Find AZs that support the requested instance type
print_info "Finding AZ that supports $INSTANCE_TYPE..."
VALID_AZ=$(aws ec2 describe-instance-type-offerings --region "$AWS_REGION" \
    --location-type availability-zone \
    --filters "Name=instance-type,Values=$INSTANCE_TYPE" \
    --query 'InstanceTypeOfferings[0].Location' --output text)
if [ -z "$VALID_AZ" ] || [ "$VALID_AZ" == "None" ]; then
    print_error "$INSTANCE_TYPE not available in $AWS_REGION"; exit 1
fi

SUBNET_ID=$(aws ec2 describe-subnets --region "$AWS_REGION" \
    --filters "Name=vpc-id,Values=$VPC_ID" "Name=default-for-az,Values=true" "Name=availability-zone,Values=$VALID_AZ" \
    --query 'Subnets[0].SubnetId' --output text)
if [ -z "$SUBNET_ID" ] || [ "$SUBNET_ID" == "None" ]; then
    print_error "No default subnet in $VALID_AZ"; exit 1
fi

VPC_CIDR=$(aws ec2 describe-vpcs --region "$AWS_REGION" \
    --vpc-ids "$VPC_ID" --query 'Vpcs[0].CidrBlock' --output text)
print_success "VPC: $VPC_ID  Subnet: $SUBNET_ID (AZ: $VALID_AZ)"

# ==========================================
# Deploy EC2 infrastructure via CloudFormation
# ==========================================

print_info "Deploying EC2 infrastructure stack: $EC2_STACK_NAME"
print_info "This creates: EC2, Security Group, IAM Role, EC2 Instance Connect Endpoint"
print_info "EIC Endpoint creation can take 5+ minutes..."
echo ""

aws cloudformation deploy \
    --template-file "$SCRIPT_DIR/chaplin-ec2-infrastructure.yaml" \
    --stack-name "$EC2_STACK_NAME" \
    --region "$AWS_REGION" \
    --parameter-overrides \
        InstanceType="$INSTANCE_TYPE" \
        AmiId="$AMI_ID" \
        ClientCidr="${CLIENT_IP}/32" \
        AppPort="$APP_PORT" \
        VpcId="$VPC_ID" \
        SubnetId="$SUBNET_ID" \
        VpcCidr="$VPC_CIDR" \
        S3BucketName="$S3_BUCKET_NAME" \
        AwsRegion="$AWS_REGION" \
        CognitoUserEmail="$COGNITO_USER_EMAIL" \
        AllowedEmailDomain="$ALLOWED_EMAIL_DOMAIN" \
    --capabilities CAPABILITY_NAMED_IAM \
    --no-fail-on-empty-changeset

if [ $? -ne 0 ]; then
    print_error "CloudFormation deployment failed"
    print_info "Check: aws cloudformation describe-stack-events --stack-name $EC2_STACK_NAME --region $AWS_REGION"
    exit 1
fi

print_success "CloudFormation stack deployed"

# ==========================================
# Retrieve outputs
# ==========================================

get_output() {
    aws cloudformation describe-stacks --stack-name "$EC2_STACK_NAME" --region "$AWS_REGION" \
        --query "Stacks[0].Outputs[?OutputKey==\`$1\`].OutputValue" --output text
}

INSTANCE_ID=$(get_output InstanceId)
PRIVATE_IP=$(get_output PrivateIp)
PUBLIC_IP=$(get_output PublicIp)
SG_ID=$(get_output SecurityGroupId)
EICE_ID=$(get_output EICEndpointId)
ROLE_NAME=$(get_output IAMRoleName)

# ==========================================
# Summary
# ==========================================

echo ""
echo "=========================================="
echo "Deployment Summary"
echo "=========================================="
echo ""
print_success "CloudFormation Stack: $EC2_STACK_NAME"
print_success "Instance:             $INSTANCE_ID"
print_success "Region:               $AWS_REGION"
print_success "Private IP:           $PRIVATE_IP"
print_success "Public IP:            $PUBLIC_IP"
print_success "Security Group:       $SG_ID (port $APP_PORT → $CLIENT_IP/32 only)"
print_success "IAM Role:             $ROLE_NAME"
print_success "EIC Endpoint:         $EICE_ID"
echo ""
print_success "App URL:              http://${PUBLIC_IP}:${APP_PORT}"
echo ""
echo "Cognito Login:"
echo "  Email:              $COGNITO_USER_EMAIL"
echo "  Temporary Password: ChaplinTemp1!"
echo "  (You MUST change this on first login)"
echo ""
echo "SSH (private, via EC2 Instance Connect Endpoint):"
echo "  aws ec2-instance-connect ssh --instance-id $INSTANCE_ID --os-user ec2-user --connection-type eice --region $AWS_REGION"
echo ""
echo "Monitor deployment (takes ~5-10 min after instance launch):"
echo "  tail -f /var/log/chaplin-deploy.log"
echo ""
echo "Check app:"
echo "  tmux attach -t chaplin"
echo ""
echo "CLEANUP - delete everything:"
echo "  aws cloudformation delete-stack --stack-name $EC2_STACK_NAME --region $AWS_REGION"
echo "  aws cloudformation delete-stack --stack-name chaplin-infrastructure-stack --region $AWS_REGION"
echo ""
print_info "Port $APP_PORT is ONLY accessible from your IP ($CLIENT_IP). No public exposure."
echo ""
