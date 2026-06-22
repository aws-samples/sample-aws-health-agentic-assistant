import json
import datetime
import logging
import boto3

logging.basicConfig(level=logging.INFO)
session = boto3.Session()


def get_account_tags(account_id):
    """Pull account-level tags from Organizations API."""
    try:
        org = session.client("organizations", region_name="us-east-1")
        resp = org.list_tags_for_resource(ResourceId=account_id)
        return {t["Key"]: t["Value"] for t in resp.get("Tags", [])}
    except Exception as e:
        print(f"Could not get org tags for {account_id}: {e}")
        return {}


def get_account_name(account_id):
    """Get account alias or name."""
    try:
        iam = session.client("iam")
        aliases = iam.list_account_aliases().get("AccountAliases", [])
        if aliases:
            return aliases[0]
    except Exception:
        pass
    return account_id


def get_monthly_spend():
    """Pull last month's spend by service from Cost Explorer."""
    try:
        ce = session.client("ce", region_name="us-east-1")
        now = datetime.datetime.now()
        first_of_month = now.replace(day=1)
        last_month_end = first_of_month - datetime.timedelta(days=1)
        last_month_start = last_month_end.replace(day=1)

        resp = ce.get_cost_and_usage(
            TimePeriod={
                "Start": last_month_start.strftime("%Y-%m-%d"),
                "End": first_of_month.strftime("%Y-%m-%d"),
            },
            Granularity="MONTHLY",
            Metrics=["UnblendedCost"],
            GroupBy=[{"Type": "DIMENSION", "Key": "SERVICE"}],
        )

        spend_by_service = {}
        total = 0.0
        for group in resp.get("ResultsByTime", [{}])[0].get("Groups", []):
            svc = group["Keys"][0]
            amount = float(group["Metrics"]["UnblendedCost"]["Amount"])
            if amount > 0:
                spend_by_service[svc] = round(amount, 2)
                total += amount

        return round(total, 2), spend_by_service
    except Exception as e:
        print(f"Could not get cost data: {e}")
        return 0, {}


def upload_account_metadata_to_s3(bucket_name, account_id):
    """Collect account metadata and upload to S3."""
    s3 = session.client("s3")

    print(f"Collecting account metadata for {account_id}...")

    tags = get_account_tags(account_id)
    account_name = get_account_name(account_id)
    total_spend, spend_by_service = get_monthly_spend()

    metadata = {
        "account_id": account_id,
        "account_name": account_name,
        "tags": tags,
        "monthly_spend": total_spend,
        "spend_by_service": spend_by_service,
        "last_updated": datetime.datetime.now().isoformat(),
    }

    file_key = f"account-metadata/{account_id}.json"
    s3.put_object(
        Bucket=bucket_name,
        Key=file_key,
        Body=json.dumps(metadata).encode("utf-8"),
    )
    print(f"Uploaded account metadata to {file_key}")
    return metadata
