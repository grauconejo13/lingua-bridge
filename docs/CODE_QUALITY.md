# Code quality conventions

Lingua Bridge uses shared formatting conventions from the beginning of implementation.

## Formatting

- **Prettier:** consistent formatting for TypeScript, JavaScript, React, JSON, stylesheets and documentation.
- **EditorConfig:** UTF-8, LF line endings, two-space indentation and final newlines.
- **ESLint:** flat config at the repo root with `typescript-eslint`, React Hooks and React Refresh rules.
- **TypeScript:** strict mode with `noUncheckedIndexedAccess`, type-checked per workspace.
- **Vitest:** unit and API tests for the server, shared package and React components.
- **CI:** GitHub Actions runs format check, lint, typecheck, tests and a production build on every pull request and push to `main`.
- **Staged-file hooks:** not added yet. Optional later.

## Prettier rules

Configured in `.prettierrc.json`:

- Semicolons enabled
- Single quotes for JS/TS
- Trailing commas where supported
- Two-space indentation
- 100-character print width
- LF line endings

## Developer workflow

```bash
npm install
npm run format        # write formatting
npm run check         # format check, lint, typecheck, tests (what CI runs, minus the build)
npm run build         # production build of web and server
```

## Review policy

1. Run formatting and lint checks before opening a PR.
2. Keep format-only changes separate from feature implementations.
3. Avoid reformatting generated assets, lockfiles, build outputs, or secrets.
4. Review unexpected diffs before committing.
5. Never commit keys or real personal/meeting information.

## Testing conventions

- The server's `mock` provider makes no network calls, so API tests and local demos never need a key or spend money.
- Provider adapters take an injected `fetch`, so tests check exactly what is sent without calling the real API.
- Tests assert that provider error details and keys never reach a client response.
- Room logic (`RoomService`) takes stub connections, so join, resume, replay, receipts and idempotency are tested without sockets. A separate suite runs the real server on a random port with WebSocket clients.
