---
description: Start/restart dev server and fix any issues
---

Start or restart the development server, monitor for errors, fix issues immediately, and provide the URL.

**Step 1: Identify the dev server command**

Find the command to start the development server:
- Check for dev/start/serve scripts in build configuration
- Look for common patterns (dev, start, serve, run, watch)

**Step 2: Check if server is already running**

Look for existing process on the typical dev port. If found, stop it first.

**Step 3: Start the dev server**

Run the dev command in the background. Monitor output for:
- Startup errors (port conflicts, missing dependencies, config issues)
- Runtime errors (compilation failures, module errors)
- Success indicators (server URL, "ready", "listening")

**Step 4: Handle any issues**

If errors appear:
- Stop the server
- Fix the errors immediately
- Restart from Step 3

If successful:
- Extract the server URL from output
- Report: "Dev server running at [URL]"

Keep response direct and concise.
