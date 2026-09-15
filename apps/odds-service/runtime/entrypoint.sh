#!/usr/bin/env bash
set -euo pipefail
export DISPLAY="${DISPLAY:-:99}"
export BROWSER_MODE="${BROWSER_MODE:-headed}"
if [[ "$BROWSER_MODE" != headed ]]; then
  echo '[Runtime] This production runtime requires BROWSER_MODE=headed' >&2
  exit 64
fi
# Railway volumes may be mounted as root. Only initialize our writable root;
# never recursively rewrite or erase browser profiles at startup.
if [[ $(id -u) == 0 ]]; then
  mkdir -p /tmp/.X11-unix
  chmod 1777 /tmp/.X11-unix
  mkdir -p "${DATA_DIR:-/service/data}"
  chown node:node "${DATA_DIR:-/service/data}"
  exec gosu node "$0" "$@"
fi
width="${BROWSER_VIEWPORT_WIDTH:-1440}"
height="${BROWSER_VIEWPORT_HEIGHT:-900}"
if [[ ! "$width" =~ ^[0-9]+$ || ! "$height" =~ ^[0-9]+$ ]]; then exit 64; fi
app_pid=''
xvfb_pid=''
stopping=0
stop_app() {
  stopping=1
  if [[ -n "$app_pid" ]]; then kill -TERM "$app_pid" 2>/dev/null || true; fi
}
trap stop_app TERM INT
Xvfb "$DISPLAY" -screen 0 "${width}x${height}x24" -nolisten tcp -noreset &
xvfb_pid=$!
cleanup() {
  kill -TERM "$xvfb_pid" 2>/dev/null || true
  wait "$xvfb_pid" 2>/dev/null || true
  echo '[Runtime] Xvfb stopped'
}
trap cleanup EXIT
# Readiness probe, bounded startup only; collection uses its own scheduler.
ready=0
for ((i=0; i<100; i++)); do
  if (( stopping )); then exit 0; fi
  if ! kill -0 "$xvfb_pid" 2>/dev/null; then echo '[Runtime] Xvfb failed' >&2; exit 1; fi
  if xdpyinfo -display "$DISPLAY" >/dev/null 2>&1; then ready=1; break; fi
  sleep 0.1
done
if (( ! ready )); then echo '[Runtime] Display startup timed out' >&2; exit 1; fi
echo "[Runtime] Xvfb ready on $DISPLAY; Chrome headed"
"$@" &
app_pid=$!
# Handle a signal delivered between the readiness probe and child registration.
if (( stopping )); then stop_app; fi
set +e
wait -n "$app_pid" "$xvfb_pid"
first_status=$?
# Keep the display alive until Nest has drained jobs/commits and closed Chrome.
# A repeated signal must not interrupt that drain.
if (( stopping )); then
  trap '' TERM INT
  wait "$app_pid"
  status=$?
elif kill -0 "$app_pid" 2>/dev/null; then
  echo '[Runtime] Display exited unexpectedly; stopping application' >&2
  stop_app
  trap '' TERM INT
  wait "$app_pid"
  status=1
else
  status=$first_status
fi
if (( stopping && status == 143 )); then status=0; fi
echo "[Runtime] Application stopped (exit $status); closing display"
exit "$status"
