#!/bin/bash
# Dev helper for AI Studio
# Usage: ./dev.sh [command]
#   start    - Start dev server (kills existing first)
#   stop     - Stop dev server
#   restart  - Restart dev server
#   check    - Type check only (fast, ~5s)
#   status   - Show if server is running

PORT=3099

case "${1:-start}" in
  start)
    fuser -k $PORT/tcp 2>/dev/null
    sleep 1
    NEXT_TURBOPACK=0 nohup pnpm dev --port $PORT > /tmp/ais-dev.log 2>&1 &
    echo "Starting dev server on port $PORT (PID: $!)..."
    echo "Logs: /tmp/ais-dev.log"
    echo "Waiting for server..."
    for i in $(seq 1 30); do
      if curl -s http://localhost:$PORT/api/health 2>/dev/null | grep -q healthy; then
        echo "Server ready!"
        exit 0
      fi
      sleep 1
    done
    echo "Server did not start in 30s. Check /tmp/ais-dev.log"
    ;;
  stop)
    fuser -k $PORT/tcp 2>/dev/null
    echo "Server stopped."
    ;;
  restart)
    $0 stop
    sleep 2
    $0 start
    ;;
  check)
    echo "Type checking..."
    npx tsc --noEmit
    if [ $? -eq 0 ]; then
      echo "No type errors."
    fi
    ;;
  status)
    if fuser $PORT/tcp 2>/dev/null; then
      echo "Server running on port $PORT"
      curl -s http://localhost:$PORT/api/health 2>/dev/null
    else
      echo "Server not running."
    fi
    ;;
  *)
    echo "Usage: $0 {start|stop|restart|check|status}"
    ;;
esac
