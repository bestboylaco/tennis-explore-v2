# Integration tests

Exercises real MongoDB Atlas / AWS services (S3, Bedrock, OpenSearch, Textract, Nova Pro per Configuration C). Needs credentials, so it only runs in CI on pushes to `main` and on manual dispatch — see `.github/workflows/ci.yml` — and never on every feature-branch push, to avoid burning the Textract/Bedrock free-tier allowance on every commit (see TENISE-28 §8).

Required secrets in GitHub (`Settings > Secrets and variables > Actions`): `MONGODB_URI`, plus AWS credentials once TENISE-11/15 land. Never print these in test output or logs (TENISE-43 T-05).

Files matching `*.test.js`, picked up by `node --test test/integration`.
