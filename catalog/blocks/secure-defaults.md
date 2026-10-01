## Secure defaults

At new external boundaries, validate untrusted input and bound sizes, ranges,
paths, and result counts. Never build SQL, shell commands, or HTML from untrusted
strings. Keep secrets out of code, logs, and error messages; return safe client
errors. Require authentication and authorization for sensitive mutations, with
least privilege. Relax a protection only on explicit request, and record the
risk in the normal task system, or in your handoff when there is none.
