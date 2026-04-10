FROM public.ecr.aws/amazonlinux/amazonlinux:2023 AS builder

RUN dnf install -y python3.11 python3.11-pip python3.11-devel gcc && dnf clean all

WORKDIR /app
ENV PIP_NO_CACHE_DIR=1

# Install dependencies first (layer caching)
COPY mcp/requirements.txt ./requirements.txt
RUN python3.11 -m venv /app/.venv && \
    /app/.venv/bin/pip install --no-cache-dir -r requirements.txt

# Copy MCP server
COPY mcp/mcp_server.py ./mcp/mcp_server.py

# Copy agent modules (mcp_server.py expects these at ../agents/ relative to mcp/)
COPY agents/agentic_analysis_simple.py ./agents/agentic_analysis_simple.py
COPY agents/DBQueryBuilder.py ./agents/DBQueryBuilder.py
COPY agents/__init__.py ./agents/__init__.py

# Copy health-dashboard .env if it exists (for AWS_REGION detection)
# This is optional — region can also be set via env var
COPY health-dashboard/.env* ./health-dashboard/

# Create output dir for cached prompts
RUN mkdir -p /app/output

# --- Runtime stage ---
FROM public.ecr.aws/amazonlinux/amazonlinux:2023

RUN dnf install -y python3.11 procps shadow-utils && \
    dnf clean all && \
    groupadd --force --system app && \
    useradd app -g app -d /home/app

ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    BYPASS_TOOL_CONSENT=true \
    HOME=/home/app

COPY --from=builder --chown=app:app /app /app
COPY mcp/docker-healthcheck.sh /usr/local/bin/docker-healthcheck.sh
RUN chmod +x /usr/local/bin/docker-healthcheck.sh

WORKDIR /app/mcp

# Mount point for AWS credentials (mounted as -v ~/.aws:/home/app/.aws:ro)
RUN mkdir -p /home/app/.aws

USER app

HEALTHCHECK --interval=60s --timeout=10s --start-period=10s --retries=3 \
    CMD ["docker-healthcheck.sh"]

ENTRYPOINT ["/app/.venv/bin/python3.11", "mcp_server.py"]
