#!/bin/bash
# Start FabricEMR server
# Usage: ./start-server.sh

set -e
cd "$(dirname "$0")"

echo "=== FabricEMR Server Startup ==="

# 1. Ensure Colima is running
if ! colima status 2>/dev/null | grep -q "Running"; then
  echo "Starting Colima..."
  colima start
  sleep 5
fi

# 2. Start main services
echo "Starting Docker services..."
docker compose up -d postgres redis llm-gateway medplum-server

# 3. Wait for medplum-server to be healthy
echo "Waiting for Medplum server..."
until curl -s http://localhost:8103/healthcheck | grep -q '"ok":true'; do
  sleep 2
done
echo "Medplum server is healthy"

# 4. Start medplum-app (use configured image if available)
echo "Starting Medplum app..."
docker rm -f fabricemr-medplum-app-1 2>/dev/null || true

if docker image inspect fabricemr-medplum-app-configured:latest >/dev/null 2>&1; then
  # Use pre-configured image
  docker run -d \
    --name fabricemr-medplum-app-1 \
    --network fabricemr_default \
    -p 3000:80 \
    --restart unless-stopped \
    fabricemr-medplum-app-configured:latest
else
  # Build from scratch
  echo "Building medplum-app from scratch..."
  docker create --name temp-medplum-app --platform linux/amd64 medplum/medplum-app:latest
  mkdir -p /tmp/medplum-app
  docker cp temp-medplum-app:/usr/share/nginx/html/. /tmp/medplum-app/
  docker rm temp-medplum-app

  docker run -d \
    --name fabricemr-medplum-app-1 \
    --network fabricemr_default \
    -p 3000:80 \
    nginx:alpine

  docker cp /tmp/medplum-app/. fabricemr-medplum-app-1:/usr/share/nginx/html/

  # Get current hostname
  HOST="$(scutil --get LocalHostName 2>/dev/null || hostname -s).local"

  # Apply config replacements
  docker exec fabricemr-medplum-app-1 sh -c "
    find /usr/share/nginx/html/assets -type f -exec sed -i \
      -e 's|__MEDPLUM_BASE_URL__|http://${HOST}:8103/|g' \
      -e 's|__MEDPLUM_CLIENT_ID__||g' \
      -e 's|__GOOGLE_CLIENT_ID__||g' \
      -e 's|__RECAPTCHA_SITE_KEY__|6LfHdsYdAAAAAC0uLnnRrDrhcXnziiUwKd8VtLNq|g' \
      -e 's|__MEDPLUM_REGISTER_ENABLED__|true|g' \
      -e 's|__MEDPLUM_AWS_TEXTRACT_ENABLED__|true|g' \
      {} \;
  "

  # Configure nginx for SPA routing
  docker exec fabricemr-medplum-app-1 sh -c 'cat > /etc/nginx/conf.d/default.conf << EOF
server {
    listen 80;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;
    location / {
        try_files \$uri \$uri/ /index.html;
    }
}
EOF'
  docker exec fabricemr-medplum-app-1 nginx -s reload

  # Save for next time
  docker commit fabricemr-medplum-app-1 fabricemr-medplum-app-configured:latest
fi

echo ""
echo "=== FabricEMR Server Ready ==="
echo "API:     http://$(scutil --get LocalHostName).local:8103"
echo "App:     http://$(scutil --get LocalHostName).local:3000"
echo "LLM:     http://$(scutil --get LocalHostName).local:8080"
echo ""
docker ps --format "table {{.Names}}\t{{.Status}}" | grep -E "fabricemr|NAMES"
