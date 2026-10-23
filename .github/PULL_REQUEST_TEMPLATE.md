# Pull Request Template

## Description

Briefly describe what this PR changes and why.

## Related Issue

Link to the issue this PR resolves (if any).

## Type of Change

Please check all that apply:

- [ ] Bug fix (non-breaking change that fixes an issue)
- [ ] New feature (non-breaking change that adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to change)
- [ ] Documentation update
- [ ] CI / build configuration
- [ ] Refactoring (no functional change)

## Checklist

Please confirm the following:

- [ ] I have read `RULES.md` and followed the ponytail principles (smallest complete change, no unrequested features, no new dependencies unless necessary)
- [ ] I have run `bun test` and all frontend tests pass
- [ ] I have run `python -m pytest backend/tests/` and all backend tests pass
- [ ] I have run `npx tsc --noEmit` and TypeScript is clean
- [ ] I have updated relevant documentation in `Docs/` if behavior changed
- [ ] I have not added mock or placeholder data
- [ ] All changes are fully wired (backend → DB → UI), no disconnected controls

## Screenshots (if applicable)

Add screenshots to help explain the change.

## Additional Context

Add any other context about the PR here.
