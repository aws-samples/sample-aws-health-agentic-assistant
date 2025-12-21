#!/bin/bash

echo "Enter the AWS region (e.g., us-east-1, us-east-2): "
read AWS_REGION
export AWS_DEFAULT_REGION=$AWS_REGION

echo "Enter the bucket name for resource upload: "
read RESOURCE_BUCKET_NAME

# Check if the buckets exist
if ! aws s3 ls "s3://${RESOURCE_BUCKET_NAME}" 2>/dev/null; then
    echo "Error: The bucket '${RESOURCE_BUCKET_NAME}' does not exist or you don't have permission to access it."
    exit 1
fi

echo "Enter the name of the S3 bucket to store your support data: "
read SUPPORT_BUCKET_NAME

if ! aws s3 ls "s3://${SUPPORT_BUCKET_NAME}" 2>/dev/null; then
    echo "Error: The bucket '${SUPPORT_BUCKET_NAME}' does not exist or you don't have permission to access it."
    exit 1
fi


echo "Cleaning up old files..."
rm -rf support-collector-lambda.zip support-collector-lambda-layer.zip python temp_dir

echo "Installing dependencies into a temporary directory..."
mkdir temp_dir
pip3 install -r ../requirements.txt -t temp_dir/

echo "Copying dependencies to the lambda directory..."
cp -r temp_dir/* ../support-collector-lambda/

echo "Creating deployment package..."
cd ../support-collector-lambda
zip -r ../support-collector-lambda.zip . -x '*.DS_Store' 2>/dev/null || true
cd ..

echo "Current directory: $PWD"

# Clean up the temporary directory
rm -rf temp_dir
echo "Deployment package created: support-collector-lambda.zip"



echo "Uploading deployment package to S3..."
aws s3 cp support-collector-lambda.zip s3://$RESOURCE_BUCKET_NAME/

# Setup Python virtual environment if it doesn't exist
if [ ! -d "../../.venv" ]; then
    echo "Creating Python virtual environment..."
    python3 -m venv ../../.venv
fi

source ../../.venv/bin/activate

# Always ensure boto3 is installed
if ! python3 -c "import boto3" 2>/dev/null; then
    echo "Installing boto3..."
    pip install --quiet boto3
    echo "boto3 installed successfully"
fi

echo "Invoking deploy_lambda_function.py..."
python3 "$PWD/individual-account-deployments/deploy_lambda_function.py" --resource_bucket_name $RESOURCE_BUCKET_NAME --support_data_bucket_name $SUPPORT_BUCKET_NAME