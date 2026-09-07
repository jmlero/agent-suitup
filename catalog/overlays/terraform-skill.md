## Project compatibility

Before applying version-specific guidance, inspect the repository's Terraform or
OpenTofu constraint, lockfile, provider versions, backend, and execution path.
Preserve the selected runtime, providers, dependencies, and conventions unless
the user asks for a migration. Verify exact feature and provider support against
the declared versions and official documentation. Treat upstream defaults as
options, not requirements. Never assume a backend supplies locking, encryption,
or versioning; verify its configured behavior. To constrain one minor release
line, use `~> x.y.0`; `~> x.y` permits later minors within the same major. Load
only the linked references relevant to the current task. Scale the upstream
response contract to the task and risk; omit sections that add no decision or
safety value. In upstream wording, “Claude” means the active coding agent.
