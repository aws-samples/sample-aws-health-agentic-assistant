# DynamoDB Encryption - Deployment Checklist

## Pre-Deployment Validation

- [x] **Configuration Files Updated**
  - [x] `table-config.json` includes SSESpecification
  - [x] CloudFormation template created (`dynamodb-table.yaml`)
  - [x] All scripts are executable

- [x] **Testing Complete**
  - [x] JSON configuration validated (9/9 tests passed)
  - [x] CloudFormation template validated
  - [x] Scripts tested and working

- [x] **Documentation Complete**
  - [x] Encryption configuration guide created
  - [x] README updated with encryption info
  - [x] Deployment summary created

## Deployment Options

### Option A: New Table with CloudFormation (Recommended)

```bash
# Step 1: Validate template
aws cloudformation validate-template \
  --template-body file://upload/dynamodb-table.yaml

# Step 2: Create stack
aws cloudformation create-stack \
  --stack-name chaplin-dynamodb-table \
  --template-body file://upload/dynamodb-table.yaml \
  --region us-east-1

# Step 3: Wait for completion
aws cloudformation wait stack-create-complete \
  --stack-name chaplin-dynamodb-table \
  --region us-east-1

# Step 4: Verify encryption
./upload/verify-encryption.sh
```

**Checklist**:
- [ ] Template validated successfully
- [ ] Stack created without errors
- [ ] Stack status: CREATE_COMPLETE
- [ ] Encryption verified
- [ ] PITR enabled

### Option B: New Table with AWS CLI

```bash
# Step 1: Test configuration
bash upload/test-table-config.sh

# Step 2: Create table
aws dynamodb create-table \
  --cli-input-json file://upload/table-config.json \
  --region us-east-1

# Step 3: Wait for table to be active
aws dynamodb wait table-exists \
  --table-name chaplin-health-events \
  --region us-east-1

# Step 4: Enable PITR
aws dynamodb update-continuous-backups \
  --table-name chaplin-health-events \
  --point-in-time-recovery-specification PointInTimeRecoveryEnabled=true \
  --region us-east-1

# Step 5: Verify encryption
./upload/verify-encryption.sh
```

**Checklist**:
- [ ] Configuration tests passed
- [ ] Table created successfully
- [ ] Table status: ACTIVE
- [ ] PITR enabled
- [ ] Encryption verified

### Option C: Enable on Existing Table

```bash
# Step 1: Backup existing data (optional but recommended)
aws dynamodb create-backup \
  --table-name chaplin-health-events \
  --backup-name chaplin-pre-encryption-backup \
  --region us-east-1

# Step 2: Run encryption script
./upload/enable-encryption.sh

# Step 3: Verify encryption
./upload/verify-encryption.sh

# Step 4: Test application
# (Verify read/write operations work)
```

**Checklist**:
- [ ] Backup created (if needed)
- [ ] Encryption enabled successfully
- [ ] PITR enabled
- [ ] Encryption verified
- [ ] Application tested

## Post-Deployment Verification

### 1. Encryption Status

```bash
aws dynamodb describe-table \
  --table-name chaplin-health-events \
  --query 'Table.SSEDescription' \
  --region us-east-1
```

**Expected**:
```json
{
    "Status": "ENABLED",
    "SSEType": "KMS",
    "KMSMasterKeyArn": "arn:aws:kms:us-east-1:123456789012:key/aws/dynamodb"
}
```

- [ ] Status: ENABLED
- [ ] SSEType: KMS
- [ ] KMSMasterKeyArn present

### 2. Point-in-Time Recovery

```bash
aws dynamodb describe-continuous-backups \
  --table-name chaplin-health-events \
  --region us-east-1
```

**Expected**: PointInTimeRecoveryStatus: ENABLED

- [ ] PITR Status: ENABLED
- [ ] Earliest restore time available

### 3. Table Status

```bash
aws dynamodb describe-table \
  --table-name chaplin-health-events \
  --query 'Table.{Status:TableStatus,ItemCount:ItemCount}' \
  --region us-east-1
```

**Expected**: TableStatus: ACTIVE

- [ ] Table Status: ACTIVE
- [ ] No errors in table description

### 4. Application Testing

**Test Read Operations**:
```bash
aws dynamodb get-item \
  --table-name chaplin-health-events \
  --key '{"healthkey":{"S":"test-key"}}' \
  --region us-east-1
```

- [ ] Read operations work
- [ ] No permission errors
- [ ] Data retrieved successfully

**Test Write Operations**:
```bash
aws dynamodb put-item \
  --table-name chaplin-health-events \
  --item '{"healthkey":{"S":"test-key"},"data":{"S":"test-value"}}' \
  --region us-east-1
```

- [ ] Write operations work
- [ ] No permission errors
- [ ] Data written successfully

### 5. Run Automated Verification

```bash
./upload/verify-encryption.sh
```

**Expected Output**:
```
✅ All critical security checks passed!

1. Encryption Status: PASS
2. Encryption Type: PASS (KMS)
3. Point-in-Time Recovery: PASS
4. Table Status: PASS (ACTIVE)
```

- [ ] All checks passed
- [ ] No errors reported

## Security Compliance Checklist

- [ ] **Encryption at Rest**: Enabled with AWS-managed KMS
- [ ] **Key Management**: AWS-managed (automatic rotation)
- [ ] **Point-in-Time Recovery**: Enabled (35-day retention)
- [ ] **Deletion Protection**: Configured (CloudFormation only)
- [ ] **IAM Policies**: Least privilege access
- [ ] **CloudTrail Logging**: Enabled for audit trail
- [ ] **Resource Tagging**: Applied for data classification
- [ ] **Documentation**: Updated and accessible

## Rollback Plan

### If Issues Occur

**Option 1: Restore from Backup**
```bash
# Restore from backup
aws dynamodb restore-table-from-backup \
  --target-table-name chaplin-health-events-restored \
  --backup-arn <BACKUP_ARN> \
  --region us-east-1
```

**Option 2: Restore from PITR**
```bash
# Restore to point in time
aws dynamodb restore-table-to-point-in-time \
  --source-table-name chaplin-health-events \
  --target-table-name chaplin-health-events-restored \
  --use-latest-restorable-time \
  --region us-east-1
```

**Option 3: Delete and Recreate (CloudFormation)**
```bash
# Delete stack
aws cloudformation delete-stack \
  --stack-name chaplin-dynamodb-table \
  --region us-east-1

# Wait for deletion
aws cloudformation wait stack-delete-complete \
  --stack-name chaplin-dynamodb-table \
  --region us-east-1

# Recreate without encryption (not recommended)
# Or fix template and redeploy
```

## Documentation Updates

- [ ] Update deployment procedures
- [ ] Update runbooks with encryption info
- [ ] Update disaster recovery procedures
- [ ] Train team on encryption features
- [ ] Update security documentation

## Monitoring Setup

### CloudWatch Alarms

```bash
# Create alarm for table errors
aws cloudwatch put-metric-alarm \
  --alarm-name chaplin-dynamodb-errors \
  --alarm-description "Alert on DynamoDB errors" \
  --metric-name UserErrors \
  --namespace AWS/DynamoDB \
  --statistic Sum \
  --period 300 \
  --threshold 10 \
  --comparison-operator GreaterThanThreshold \
  --dimensions Name=TableName,Value=chaplin-health-events
```

- [ ] CloudWatch alarms configured
- [ ] SNS notifications set up
- [ ] Dashboard created

## Sign-Off

### Development Team
- [ ] Code changes reviewed
- [ ] Configuration validated
- [ ] Testing complete

### Security Team
- [ ] Encryption configuration approved
- [ ] Compliance requirements met
- [ ] Security controls verified

### Operations Team
- [ ] Deployment plan reviewed
- [ ] Rollback plan tested
- [ ] Monitoring configured
- [ ] Documentation updated

## Final Checklist

- [ ] All pre-deployment validations passed
- [ ] Deployment method selected and executed
- [ ] Post-deployment verification complete
- [ ] Application tested and working
- [ ] Security compliance verified
- [ ] Monitoring and alerting configured
- [ ] Documentation updated
- [ ] Team trained on new features
- [ ] Rollback plan documented and tested

---

**Deployment Date**: _______________  
**Deployed By**: _______________  
**Verified By**: _______________  
**Status**: ⬜ Pending / ⬜ In Progress / ⬜ Complete
