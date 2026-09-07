## Project compatibility

Inspect the repository's Python, FastAPI, Pydantic, and dependency versions
before applying version-specific guidance. Use only APIs supported by those
versions; native SSE requires FastAPI 0.135+, and `app.frontend()` or
`router.frontend()` requires 0.138+. Preserve existing libraries and project
conventions unless the user asks for a migration. Treat upstream library
preferences as options, not requirements, and load only the linked references
relevant to the current task.
