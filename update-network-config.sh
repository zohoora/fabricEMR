#!/bin/bash
# Updates medplum.config.json with current network IP or hostname
# Usage: ./update-network-config.sh [ip|hostname]

set -e
cd "$(dirname "$0")"

CONFIG_FILE="medplum.config.json"

get_local_ip() {
  ifconfig | grep "inet " | grep -v 127.0.0.1 | awk '{print $2}' | head -1
}

get_hostname() {
  scutil --get LocalHostName 2>/dev/null || hostname -s
}

MODE="${1:-hostname}"

if [ "$MODE" = "ip" ]; then
  HOST=$(get_local_ip)
  if [ -z "$HOST" ]; then
    echo "Error: Could not determine local IP address"
    exit 1
  fi
  echo "Using IP: $HOST"
else
  HOST="$(get_hostname).local"
  echo "Using hostname: $HOST"
fi

# Update the config file
if [ ! -f "$CONFIG_FILE" ]; then
  echo "Error: $CONFIG_FILE not found"
  exit 1
fi

# Use sed to replace the URLs
sed -i.bak -E "s|\"baseUrl\": \"http://[^/]+:8103/\"|\"baseUrl\": \"http://${HOST}:8103/\"|" "$CONFIG_FILE"
sed -i.bak -E "s|\"appBaseUrl\": \"http://[^/]+:3000/\"|\"appBaseUrl\": \"http://${HOST}:3000/\"|" "$CONFIG_FILE"
sed -i.bak -E "s|\"storageBaseUrl\": \"http://[^/]+:8103/storage/\"|\"storageBaseUrl\": \"http://${HOST}:8103/storage/\"|" "$CONFIG_FILE"

rm -f "${CONFIG_FILE}.bak"

echo "Updated $CONFIG_FILE:"
grep -E "(baseUrl|appBaseUrl|storageBaseUrl)" "$CONFIG_FILE"

echo ""
echo "Restart Medplum server to apply changes:"
echo "  docker compose restart medplum-server"
