## Test-driven development

For features and bug fixes, first write a test for the intended behavior and
confirm it fails for the expected reason; for a bug, the test reproduces it.
Then make it pass with the smallest change and refactor the code you touched
while tests stay green. Keep tests independent, name them by behavior, and mock
only external boundaries. If testing first is impractical, say so rather than
skipping it.
