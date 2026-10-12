# Security Policy

## Supported Versions

Security fixes are released for the latest published version of `@codemieai/cdk`.

## Reporting a Vulnerability

Do not open a public issue for a security problem.

Use the GitHub Security Advisory feature of the `codemie-ai/codemie-cdk` repository:

1. Open the **Security** tab of the repository.
2. Choose **Report a vulnerability**.
3. Describe the problem, the affected version, and steps to reproduce it.

Do not include real credentials or customer data in the report.

## What to Expect

- We acknowledge a report within a few business days.
- We assess the report and tell you if we accept it.
- We prepare a fix and release it, then publish the advisory.

## Disclosure Policy

Please keep the report private until a fix is released. We credit reporters in the advisory if they agree.

## Guidance for Users

- Keep client secrets and tokens out of source control. Read them from environment variables or a secret store, and do not commit your `.env` file.
- Verify TLS certificates. Do not disable certificate checks in production.
- Keep `@codemieai/cdk` up to date.
