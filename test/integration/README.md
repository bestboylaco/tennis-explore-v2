# Integration tests

Exercises real MongoDB Atlas / AWS services (S3, Bedrock, OpenSearch, Textract per Configuration C). Needs credentials, so it only runs in CI on pushes to `main` and on manual dispatch — see `.github/workflows/ci.yml` — and never on every feature-branch push, to avoid burning the Textract/Bedrock free-tier allowance on every commit (see TENISE-28 §8).

Generation (TENISE-19) is the exception: it runs against a local Ollama server instead of Nova Pro/Bedrock, per the project's move away from AWS Bedrock (Head project decision, 2026-07-30). It needs no cloud credentials, but does need Ollama running locally with the configured model pulled (`OLLAMA_BASE_URL`, `OLLAMA_GENERATION_MODEL` in `.env`) — it skips itself cleanly if Ollama is unreachable, which is expected on the CI runner today.

Required secrets in GitHub (`Settings > Secrets and variables > Actions`): `MONGODB_URI`, plus AWS credentials once TENISE-11/15 land. Never print these in test output or logs (TENISE-43 T-05).

Files matching `*.test.js`, picked up by `node --test test/integration`.

`test:integration` runs with `--test-force-exit`. Tests that dynamically import
`src/app.js` (auth.test.js, telemetryHttpRoute.test.js) pull in the session
middleware's `connect-mongo` store, which opens its own MongoDB connection
separate from the one the test's own `before()`/`after()` opens and closes.
Nothing in the test file has a handle to close it, so without this flag the
process hangs after every assertion has already passed -- confirmed by running
a suite directly and watching it sit at 100% pass with no exit. The flag is a
deliberate, minimal fix for that specific leak, not a general "ignore hung
tests" switch.
