---
name: Deployment request size cap
description: Published deployments cap a single HTTP request at ~32 MB; large uploads must be chunked.
---

The published (Autoscale) deployment rejects HTTP requests larger than ~32 MB at the infrastructure level — the request never reaches Express, so no server log appears and the client sees a generic network failure. The dev workspace has no such cap, so large uploads "work in preview but fail in production".

**Why:** A 45 MB multipart batch upload (86 SWMM models pulled from GitHub) failed on the live site with a generic "Failed to upload files" while succeeding in dev; server logs showed no POST at all — the giveaway that the request died in transit.

**How to apply:** Any client upload path must chunk payloads well under the cap (the app uses ~20 MB chunks: first chunk POST /api/upload creates the job, later chunks POST /api/batch/:id/files append under a per-job lock; /start waits on the lock and rejects further appends). When debugging "works in dev, fails deployed" uploads, check payload size first.
