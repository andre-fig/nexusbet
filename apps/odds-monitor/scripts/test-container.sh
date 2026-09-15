#!/bin/sh
set -eu

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required to validate the odds-monitor deployment image" >&2
  exit 1
fi

image="nexusbet-odds-monitor:pre-push"
container="nexusbet-odds-monitor-pre-push-$$"

cleanup() {
  docker rm --force "$container" >/dev/null 2>&1 || true
}
trap cleanup EXIT HUP INT TERM

docker build --tag "$image" .
docker run --detach --rm --name "$container" "$image" >/dev/null

attempt=1
while [ "$attempt" -le 15 ]; do
  if docker exec "$container" node -e '
    fetch("http://127.0.0.1:3000/healthz")
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok || body.status !== "ok") process.exit(1);
      })
      .catch(() => process.exit(1));
  '; then
    echo "odds-monitor container build and healthcheck passed"
    exit 0
  fi

  if [ "$(docker inspect --format '{{.State.Running}}' "$container" 2>/dev/null || true)" != "true" ]; then
    echo "odds-monitor container stopped before becoming healthy" >&2
    docker logs "$container" >&2 || true
    exit 1
  fi

  attempt=$((attempt + 1))
  sleep 1
done

echo "odds-monitor container did not become healthy within 15 seconds" >&2
docker logs "$container" >&2 || true
exit 1
