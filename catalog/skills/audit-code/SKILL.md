---
name: audit-code
description: Audit a codebase for production readiness before deployment or release. Check security, error handling, authentication, validation, persistence, infrastructure, tests, and dependencies. Do not use for reviewing only one pull request.
---

# Production readiness audit

Inspect the repository and report evidence-backed findings. Do not change files
unless the user separately asks for fixes.

## Checks

Evaluate applicable checks as PASS, WARN, or FAIL; mark irrelevant checks N/A.

1. Security
   - No committed secrets or unsafe local environment files.
   - Inputs are parameterized or escaped against injection and XSS.
   - Mutating operations enforce authentication and authorization.
   - Protected tokens and sessions are validated correctly.
   - CORS, debug output, and client errors do not expose internals.
2. Error handling
   - Clients receive appropriate status codes and safe messages.
   - Operators retain enough server-side detail to diagnose failures.
   - User interfaces handle loading, empty, retry, and error states.
3. Input validation
   - API and command boundaries validate shape, size, type, and range.
   - Uploads, paths, pagination, and query limits are constrained.
4. Persistence
   - Queries are bounded and important access paths are indexed.
   - Transactions, constraints, cascades, and connection pools are deliberate.
5. Containers and infrastructure
   - Runtime processes use least privilege and expose only required ports.
   - Health checks, production builds, and ignore files are appropriate.
6. Code and tests
   - Critical paths and failure cases are tested.
   - Suspicious TODOs, dead code, inconsistency, and duplication are identified.
7. Dependencies
   - Run the repository's committed audit tooling when safe and available.
   - Flag known critical vulnerabilities, loose production pins, and unused packages.

## Report

Return:

- counts for PASS, WARN, FAIL, and N/A;
- critical findings first;
- warnings second;
- passed checks last.

For every FAIL or WARN, cite `file:line`, explain the impact, and give a concrete
recommendation. Distinguish verified findings from checks that could not be run.
