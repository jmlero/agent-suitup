## CI and production parity

Keep CI runtime versions and build paths aligned with production. When a
runtime, base image, lockfile, or production build command changes, update the
corresponding CI configuration in the same change. Before completion, run the
closest available CI-equivalent check or report exactly what was not run.
