# Code quality conventions

Lingua Bridge uses shared formatting conventions from the beginning of implementation.

## Formatting

- **Prettier:** consistent formatting for TypeScript, JavaScript, React, JSON, stylesheets and documentation.
- **EditorConfig:** UTF-8, LF line endings, two-space indentation and final newlines.
- **ESLint:** will be added alongside the frontend/backend TypeScript scaffolds so it uses the actual framework plugins and module settings.
- **CI and staged-file hooks:** will be added once package manifests and a lockfile exist. Do not advertise lint or CI checks before they run.

## Prettier rules

Configured in `.prettierrc.json`:
- Semicolons enabled
- Single quotes for JS/TS
- Trailing commas where supported
- Two-space indentation
- 100-character print width
- LF line endings

## Developer workflow (after JavaScript workspace setup)

```bash
npm install
npm run format
npm run format:check
npm run lint
```

These commands are **planned**, not available yet. The workspace scripts will be introduced with the initial app scaffold.

## Review policy

1. Run formatting and lint checks before opening a PR.
2. Keep format-only changes separate from feature implementations.
3. Avoid reformatting generated assets, lockfiles, build outputs, or secrets.
4. Review unexpected diffs before committing.
5. Never commit keys or real personal/meeting information.

## Next implementation task

Scaffold the npm workspaces and frontend/backend, install and pin Prettier and the appropriate ESLint/TypeScript integrations, add package scripts, produce a lockfile, then activate GitHub Actions and optional lint-staged/Husky.
