#!/bin/bash
set -e

# Script to clone production database to local Docker container for migration testing
# Usage: ./scripts/clone-db-to-local.sh

CONTAINER_NAME="cvm-local-postgres"
LOCAL_PORT=5433
LOCAL_PASSWORD="localpassword"
LOCAL_DB="ai-app-template"
DUMP_FILE="/tmp/cvm-prod-dump.sql"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}=== Clone Production Database to Local Docker ===${NC}"

# Load production DATABASE_URL from the workspace-root .env (one file for the
# whole monorepo — see app/cli/env.ts).
ENV_FILE="$(cd "$(dirname "$0")/../../.." && pwd)/.env"
if [ -f "$ENV_FILE" ]; then
    export $(grep -v '^#' "$ENV_FILE" | grep DATABASE_URL | xargs)
else
    echo -e "${RED}Error: .env file not found${NC}"
    exit 1
fi

if [ -z "$DATABASE_URL" ]; then
    echo -e "${RED}Error: DATABASE_URL not set in .env${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Loaded DATABASE_URL from .env${NC}"

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}Error: Docker is not running${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Docker is running${NC}"

# Create or start the local PostgreSQL container
if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
        echo -e "${GREEN}✓ Container ${CONTAINER_NAME} is already running${NC}"
    else
        echo -e "${YELLOW}Starting existing container ${CONTAINER_NAME}...${NC}"
        docker start "$CONTAINER_NAME"
        sleep 3
        echo -e "${GREEN}✓ Container started${NC}"
    fi
else
    echo -e "${YELLOW}Creating new PostgreSQL container ${CONTAINER_NAME}...${NC}"
    docker run -d \
        --name "$CONTAINER_NAME" \
        -e POSTGRES_PASSWORD="$LOCAL_PASSWORD" \
        -e POSTGRES_DB="$LOCAL_DB" \
        -p "${LOCAL_PORT}:5432" \
        postgres:17

    echo -e "${YELLOW}Waiting for PostgreSQL to be ready...${NC}"
    sleep 5
    echo -e "${GREEN}✓ Container created and started${NC}"
fi

# Wait for PostgreSQL to be ready
echo -e "${YELLOW}Checking PostgreSQL readiness...${NC}"
for i in {1..30}; do
    if docker exec "$CONTAINER_NAME" pg_isready -U postgres > /dev/null 2>&1; then
        echo -e "${GREEN}✓ PostgreSQL is ready${NC}"
        break
    fi
    if [ $i -eq 30 ]; then
        echo -e "${RED}Error: PostgreSQL did not become ready in time${NC}"
        exit 1
    fi
    sleep 1
done

# Dump production database (using pg_dump from container to match server version)
echo -e "${YELLOW}Dumping production database...${NC}"
docker exec "$CONTAINER_NAME" pg_dump "$DATABASE_URL" --no-owner --no-acl > "$DUMP_FILE"
echo -e "${GREEN}✓ Production database dumped to ${DUMP_FILE}${NC}"

# Drop and recreate database in local container
echo -e "${YELLOW}Preparing local database...${NC}"
docker exec "$CONTAINER_NAME" psql -U postgres -c "DROP DATABASE IF EXISTS \"${LOCAL_DB}\";" 2>/dev/null || true
docker exec "$CONTAINER_NAME" psql -U postgres -c "CREATE DATABASE \"${LOCAL_DB}\";"
echo -e "${GREEN}✓ Local database prepared${NC}"

# Restore dump to local container
echo -e "${YELLOW}Restoring dump to local container...${NC}"
docker exec -i "$CONTAINER_NAME" psql -U postgres -d "$LOCAL_DB" < "$DUMP_FILE"
echo -e "${GREEN}✓ Database restored to local container${NC}"

# Clean up dump file
rm -f "$DUMP_FILE"

# Print connection info
LOCAL_URL="postgresql://postgres:${LOCAL_PASSWORD}@localhost:${LOCAL_PORT}/${LOCAL_DB}"
echo ""
echo -e "${GREEN}=== Clone Complete ===${NC}"
echo -e "Local database URL:"
echo -e "${YELLOW}${LOCAL_URL}${NC}"
echo ""
echo -e "To test migrations on local, set DATABASE_URL to the above URL"
echo -e "Or create a .env.local file with:"
echo -e "  DATABASE_URL=\"${LOCAL_URL}\""
echo ""
echo -e "To stop the container:  ${YELLOW}docker stop ${CONTAINER_NAME}${NC}"
echo -e "To remove the container: ${YELLOW}docker rm ${CONTAINER_NAME}${NC}"
