# ScopeWeaver v0.9.3 — Zod advisory fully remediated in the OpenCode SDK bridge

v0.9.2 moved the default `native` runtime of the opt-in OpenCode SDK bridge onto the patched `zod` 4.6.7, but
`bun audit` still reported [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) for two reasons:
the `legacy` runtime's `@opencode-ai/plugin` 1.19.4 pinned `zod` 4.1.8, and `gitlab-ai-provider` 6.24.0 declared
`zod ^3.25.76`. This release resolves the whole bridge dependency tree to `zod` 4.6.7, which closes
[#67](https://github.com/cskwork/scopeweaver/issues/67). See [#92](https://github.com/cskwork/scopeweaver/pull/92).

## Security

- `adapters/opencode-sdk/package.json` overrides `zod` to 4.6.7. The bridge's dependency tree now contains a
  single `zod` 4.6.7, and `bun audit` no longer reports the Zod advisory. Two moderate advisories that were
  already present remain: `minimatch` and `glob`, through `@opencode/util` and `@opencode/ai`.

## Compatibility

- The override sets aside `gitlab-ai-provider`'s declared `zod ^3.25.76` contract. Its actual zod usage is
  `z.object`, `z.string`, `z.number`, `z.record` and `z.infer`. All of these work in zod 4.6.7, including the
  v3-style one-argument `z.record`. Under zod 4.6.7, the provider loads, validates its OAuth token schema,
  rejects invalid input and builds a model object. **A real GitLab Duo request has not been tested.**
- No server, database, LLM profile or bridge protocol change. The `native` 2.3.0 and `legacy` 1.19.4 runtimes
  are unchanged.

## Upgrade and verification

There is no database migration. If you use the OpenCode SDK bridge, reinstall its dependencies
(`bun install --frozen-lockfile` in `adapters/opencode-sdk`) and restart the bridge.

Verified locally (macOS arm64): the adapter suite (`bun run check && bun test`) passed 63 of 63, including the
`legacy` runtime. Before release, all required checks and `e2e` must pass on the PR, on `dev` and on `main`.

## 한국어

v0.9.2에서는 선택 기능인 OpenCode SDK 브리지의 기본 `native` 런타임만 패치된 `zod` 4.6.7로 옮겼습니다.
`legacy` 런타임의 `@opencode-ai/plugin` 1.19.4가 `zod` 4.1.8을 고정하고 `gitlab-ai-provider` 6.24.0이
`zod ^3.25.76`을 선언해, `bun audit`은 계속 GHSA-mrhx-c7xc-m3w5를 보고했습니다. 이번 릴리스는 브리지
의존성 트리 전체를 `zod` 4.6.7로 맞춰 [#67](https://github.com/cskwork/scopeweaver/issues/67)을 해결합니다
([#92](https://github.com/cskwork/scopeweaver/pull/92)).

- `adapters/opencode-sdk/package.json`의 `overrides`로 `zod`를 4.6.7로 강제합니다. 트리에는 `zod` 4.6.7
  하나만 남으며, 기존 moderate 권고 2건(`minimatch`, `glob`)은 그대로입니다.
- `gitlab-ai-provider`가 선언한 zod 3 계약을 덮어씁니다. 이 패키지가 쓰는 `z.object`·`z.string`·`z.number`·
  `z.record`(v3 방식의 1개 인자 포함)·`z.infer`는 zod 4.6.7에서 모두 동작합니다. 로드·OAuth 토큰 스키마
  검증·모델 생성은 확인했지만 **실제 GitLab Duo 요청은 시험하지 않았습니다.**
- 서버·데이터베이스·LLM 프로필·브리지 프로토콜 변경과 마이그레이션은 없습니다. OpenCode SDK 브리지를 쓰면
  `adapters/opencode-sdk`에서 `bun install --frozen-lockfile`로 의존성을 다시 설치하고 브리지를 다시 시작하세요.
