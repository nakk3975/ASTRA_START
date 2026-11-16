# Meshy assets v1.1

Shipping assets are in `apps/web/public/assets/visuals/1.1.0/`. The manifest records task IDs, actual hashes, byte sizes, triangles and texture dimensions. Approval stays pending until actual in-game review.

The original design catalog remains an input specification; its NOT_GENERATED fields are not falsely changed to approved. No runtime Meshy API or expiring download URL is used.

Production pipeline: reference → Meshy T2/T2.5 + N1 → local geometry cleanup where necessary → worker rig and motions → measured LODs and WebP textures → SHA-256 filename → actual game review. `scripts/prepare-asset.mjs` is the offline optimizer. Production originals and sanitized provenance are retained separately from client shipping GLBs.
