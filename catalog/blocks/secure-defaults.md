## Secure defaults

At new external boundaries, validate untrusted input and constrain sizes,
ranges, paths, and result counts. Use parameterized queries, and never build
shell commands, SQL, or HTML from untrusted strings. Keep secrets out of code,
logs, and error messages. Require authentication and authorization for
sensitive mutations. Return safe client errors while retaining diagnostic
detail server-side. Use least privilege by default. Relax a protection only
when explicitly requested, and record the resulting risk in the repository's
normal task system, or in your handoff when there is none.
