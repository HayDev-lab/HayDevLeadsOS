#!/bin/bash
# Ensure the Next.js dev server is up (sandbox may reap background processes
# between tool calls — this makes every QA step self-healing).
cd /home/z/my-project

if curl -s -m 3 -o /dev/null -w "%{http_code}" http://localhost:3000/api/v1/seed 2>/dev/null | grep -q "200"; then
  echo "dev server already up"
  exit 0
fi

# Kill leftovers, then double-fork daemonize: fully detached from this shell.
pkill -9 -f "next dev" 2>/dev/null
pkill -9 -f "next-server" 2>/dev/null
sleep 1

python3 - <<'PYEOF'
import os, sys, subprocess

# Double-fork: child re-parents to init, escapes process-group cleanup.
if os.fork() > 0:
    sys.exit(0)
os.setsid()
if os.fork() > 0:
    sys.exit(0)

# Redirect std streams; the npm script itself tees to dev.log
fd = os.open(os.devnull, os.O_RDWR)
os.dup2(fd, 0)
os.dup2(fd, 1)
os.dup2(fd, 2)
if fd > 2:
    os.close(fd)
subprocess.Popen(["bun", "run", "dev"], cwd="/home/z/my-project",
                 start_new_session=True)
PYEOF

# Wait for readiness (first boot compiles routes lazily — up to 90s)
for i in $(seq 1 90); do
  code=$(curl -s -m 3 -o /dev/null -w "%{http_code}" http://localhost:3000/api/v1/seed 2>/dev/null)
  if [ "$code" = "200" ]; then
    echo "dev server started (attempt $i)"
    exit 0
  fi
  sleep 1
done
echo "FAILED to start dev server"
tail -20 /home/z/my-project/dev.log 2>/dev/null
exit 1
