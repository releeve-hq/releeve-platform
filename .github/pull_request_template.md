## Summary

Describe the behavior changed and why.

## Risk

Describe affected data, APIs, migrations, permissions, or user workflows.

## Verification

List exact commands, test counts, and manual evidence. Include screenshots for
visible frontend changes.

## Checklist

- [ ] The change is scoped and contains no secrets or generated local state.
- [ ] Formatting, linting, type checks, and relevant tests pass.
- [ ] API behavior and OpenAPI are updated together when contracts change.
- [ ] Database migrations are forward-safe and tested from empty and prior schemas.
- [ ] Authentication and organization/project isolation were considered.
- [ ] User-facing error, loading, empty, and cancellation states were verified.
