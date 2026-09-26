## CI and production parity

Keep CI runtime versions and build paths aligned with production. When a
runtime, base image, lockfile, or production build command changes, update the
corresponding CI configuration in the same change. Include the closest
available CI-equivalent check in the relevant checks before completion, and
report it as skipped if it cannot run.
