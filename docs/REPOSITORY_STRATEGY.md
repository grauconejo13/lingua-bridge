# Public and Private Repository Strategy

> Status: **proposed operating strategy**. Only the public `lingua-bridge` repository currently exists. This document does not imply the commercial platform has been built.

## Objectives

- Publish a credible, runnable portfolio MVP that demonstrates engineering skill.
- Keep proprietary commercial implementations and operational configuration private.
- Avoid maintaining two divergent products or accidentally publishing sensitive information.
- Make clear which features are real, planned, or experimental.

## Repository roles

|               | Public: `lingua-bridge`                                                                 | Private (proposed): `lingua-bridge-platform`                                                          |
| ------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Purpose       | Reviewable portfolio MVP and technical case study                                       | Product development and commercial operations                                                         |
| Code          | Demonstrable speech capture, translation, caption/audio UI, tests, sample configuration | Production-grade orchestration, premium features, billing, admin tools, vendor-specific optimizations |
| Documentation | Setup, architecture at a non-sensitive level, accessibility and performance results     | Threat models, internal runbooks, operating costs, rollout plans, internal design decisions           |
| Data          | Synthetic fixtures only                                                                 | Minimal live data only when authorized and necessary                                                  |
| Deployment    | Public demo with quotas and non-sensitive environment settings                          | Production staging and live services with controlled access                                           |
| Status        | Exists; documentation-only                                                              | Not yet created                                                                                       |

The public MVP may be functionally complete within its _limited_ scope. The private repository is not a substitute for secure hosting, access controls, and secret management.

## Functional boundary

**Public MVP candidates**

- Language registry with provider-supported languages (do not hardcode the architecture to one pair).
- User-configurable spoken and listening languages.
- Speech capture, translated text, and optional synthesized audio.
- Accessible captions, microphone consent, mute/stop controls.
- Basic low-bandwidth fallback and reproducible tests.
- Demo documentation and measured latency/quality outcomes.

**Private product candidates**

- Advanced multi-user rooms, conferencing and authorized platform integrations.
- Adaptive network logic, delivery guarantees and store-and-forward infrastructure.
- Subscription billing, organization controls, analytics, and usage enforcement.
- Proprietary provider routing, optimization, and production deployment infrastructure.

These are proposed boundaries, not guarantees. Publish only non-sensitive information with permission, and avoid claiming planned capabilities are deployed.

## Code-sharing approach

1. **Start with one public MVP.** Avoid premature duplication until the core architecture and deployment prove useful.
2. **Create the private product repository when commercial development begins.** Set it private _before_ pushing proprietary material.
3. **Choose a single source of truth for shared code.** Prefer an explicitly versioned shared module/package (or controlled upstream sync), rather than manually copying files both ways.
4. **Review synchronization direction.** Public-to-private adoption can be straightforward; private-to-public contributions require a deliberate review for secrets, licenses, user data, internal URLs, contracts, and proprietary logic.
5. **Document dependencies and releases.** Pin package versions, test compatibility, and record whether changes apply to both products.

Do not assume the two codebases must have identical features or release schedules. Avoid git-history rewriting as a routine privacy measure.

## Security, licensing, and intellectual property

- Keep API keys, tokens, credentials, certificates, private keys, and real user data **out of both repositories**. Use secret managers or host-provided environment variables; commit only `.env.example` placeholders.
- Set least-privilege access for collaborators and CI/CD. Enable branch protections, code review, dependency scanning, and secret scanning where available.
- Review documentation, issues, commits, and pull requests for private or identifying details before publication.
- A public repository is not automatically open-source: select a license intentionally after reviewing third-party dependencies and project goals.
- Public access or removing a file later does not undo disclosure. Git history, forks, and caches can preserve older content.
- Keeping source private does not grant exclusive rights to the general product idea. Seek professional legal advice before making IP or patent decisions if needed.

## Privacy and public communication policy

- Public docs must describe **general user problems and product functionality only**. Do not mention specific individuals, personal experiences, or identifiable origin stories.
- Use fictional examples and synthesized/sample data in demos.
- Request clear consent for microphone access and any meeting-media processing. Do not record or retain audio by default without a documented policy.
- Distinguish working features, prototypes, and future goals across READMEs, demo videos, and resume descriptions.

## Practical workflow

1. Develop public MVP changes in feature branches with tests and focused PRs.
2. Review privacy/security checklist before each public merge.
3. Publish tagged releases and demo instructions that work without access to commercial code.
4. Develop private features independently behind appropriate access controls.
5. Share improvements only through reviewed, versioned components or carefully reviewed ports.

### Public release checklist

- [ ] No personal stories, identifying details, secrets, or real user datasets.
- [ ] No accidental proprietary algorithms, operational runbooks, or private infrastructure endpoints.
- [ ] Licensed dependencies and assets have been reviewed.
- [ ] README claims match verified functionality; setup commands work.
- [ ] Sample environment file contains placeholders only.
- [ ] Rate limiting/cost controls applied to public cloud demo.
- [ ] Accessibility, privacy, and core test results documented.

## Decisions pending

- Final license and contribution policy.
- Shared-package strategy once a private product exists.
- Which features, if any, stay exclusively commercial.
- Hosting architecture, operating budget, and demo quotas.

## Immediate next step

Keep the current public repository documentation-first. Build and validate a modest public multilingual translation MVP before creating or claiming a production-ready private service.
