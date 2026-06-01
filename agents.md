# Agent Guardrails for pi-streak

## NPM Publishing Rules

**ALWAYS follow these rules before any npm publish:**

1. **Test first, publish second** — Never publish without running the actual command locally. Use `npm pack` + `npm install -g <tgz>` to test the exact package users will receive.

2. **Get user consent** — Never publish without explicit user approval. Say "Ready to publish X.Y.Z?" and wait for yes.

3. **Small increments only** — Do not jump versions. If latest is 1.2.4, next is 1.2.5, not 1.3.0 or 2.0.0. Only bump minor/major when the user explicitly asks.

4. **No frequent publishes** — Bundle fixes. Don't publish for every tiny change. Wait until there's a meaningful set of changes.

5. **Check the binary works** — After `npm install -g`, actually run the CLI command. Permission errors, ESM/CJS mismatches, and missing files only show up in real installs.

6. **Never assume** — Just because `bun run` works doesn't mean `npx` or global install works. Test the actual distribution path.

## Publishing Checklist

- [ ] Test locally with `npm pack` + `npm install -g <tgz>`
- [ ] Run `pi-streak --help` and at least one real command
- [ ] Ask user: "Publish version X.Y.Z?"
- [ ] Bump version by smallest increment (patch > minor > major)
- [ ] Push to git first
- [ ] Then publish to npm

## Consequences

Publishing broken packages wastes user trust, creates uninstallable versions, and forces rapid patch spam. Don't do it.
