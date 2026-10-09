# Change Stack v0.1.8

Use high reasoning, a 600-second model request timeout, and 30,000 input characters per call by default.

- On the first run after upgrading, replace these three saved model values once, including values previously imported from other settings. Preserve model identity, endpoint, credentials, custom prompts, and other generation options.
- Apply the same defaults during new setup and imports, including imported reasoning options in the request body.
- Keep command-line timeout/context overrides and `--no-reasoning` available. Settings changed after migration remain saved.
- Add regression checks for migration, imported values, outgoing requests, and command-line overrides.

The standalone download is for **macOS Apple Silicon (arm64)** and includes the binary, English/Russian instructions, and license notices. No Bun or Node.js is required. Verify the archive using `SHA256SUMS`. The binary is unsigned and not notarized.
