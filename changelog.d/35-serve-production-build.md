- The Docker container now builds the site at start and serves the build
  (`vite preview`) instead of the Vite dev server. Pages no longer hang on the
  loading screen after a deploy, when an open page mixed modules from the old
  and new containers and ran two copies of Vue. Set `GEV_SERVE_MODE=dev` to
  go back to the dev server. Every page (`index`, `scenarios`, `ev-planning`,
  `admin`) is now part of the build.
