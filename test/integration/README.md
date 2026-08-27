# Integration tests

Exercises real MongoDB Atlas / AWS services (S3, Bedrock, OpenSearch, Textract per Configuration C). Needs credentials, so it only runs in CI on pushes to `main` and on manual dispatch — see `.github/workflows/ci.yml` — and never on every feature-branch push, to avoid burning the Textract/Bedrock free-tier allowance on every commit (see TENISE-28 §8).

Generation (TENISE-19) is the exception: it runs against a local Ollama server instead of Nova Pro/Bedrock, per the project's move away from AWS Bedrock (Head project decision, 2026-07-30). It needs no cloud credentials, but does need Ollama running locally with the configured model pulled (`OLLAMA_BASE_URL`, `OLLAMA_GENERATION_MODEL` in `.env`) — it skips itself cleanly if Ollama is unreachable, which is expected on the CI runner today.

`s3Upload.test.js` is the same shape again, for the S3 asset-storage work (`STORAGE_PROVIDER=s3`, `src/infrastructure/storage/`). It needs no AWS credentials either — it runs against a local S3-compatible server, `docker compose up -d` (MinIO, see `docker-compose.yml`), and skips itself cleanly if nothing answers at `S3_TEST_ENDPOINT` (default `http://localhost:9000`). Not yet wired into CI: that would mean adding MinIO as a service container to `.github/workflows/ci.yml`, which hasn't been done. Verified manually against a real MinIO container and a real `bin/build-index.js` run as of 2026-08-27.

Required secrets in GitHub (`Settings > Secrets and variables > Actions`): `MONGODB_URI`, plus AWS credentials once TENISE-11/15 land. Never print these in test output or logs (TENISE-43 T-05).

Files matching `*.test.js`, picked up by `node --test test/integration`.

Run with `--test-concurrency=1`, so files execute one at a time rather than
node's default of running matched files concurrently across CPU cores. With
several files opening their own connection to the same free-tier (M0) Atlas
cluster at once, PR #29's CI run (2026-08-21) saw `telemetryAggregation.test.js`
intermittently read back zero records for a correlationId it had just
inserted -- the same aggregation returning both the correct count and 0 within
one suite run, with per-query latency identical whether or not it found data,
which pointed at the cluster being overloaded by concurrent connections rather
than a real race in the test's own before()/after(). Serializing file
execution removes that concurrent load; it did not reproduce locally where
this suite was the only thing hitting the cluster.

`test:integration` runs with `--test-force-exit`. Tests that dynamically import
`src/app.js` (auth.test.js, telemetryHttpRoute.test.js) pull in the session
middleware's `connect-mongo` store, which opens its own MongoDB connection
separate from the one the test's own `before()`/`after()` opens and closes.
Nothing in the test file has a handle to close it, so without this flag the
process hangs after every assertion has already passed -- confirmed by running
a suite directly and watching it sit at 100% pass with no exit. The flag is a
deliberate, minimal fix for that specific leak, not a general "ignore hung
tests" switch.
