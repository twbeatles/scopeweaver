# ScopeWeaver v0.9.2 — OpenCode SDK bridge runtime 2.3.0

The default `native` runtime of the opt-in OpenCode SDK bridge moves from OpenCode CLI/client/SDK 2.1.4 to
2.3.0. Its `@opencode/core` now resolves the patched `zod` 4.6.7, so the default runtime no longer validates
through `zod` 4.1.8 ([GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5),
[#67](https://github.com/cskwork/scopeweaver/issues/67)). See [#89](https://github.com/cskwork/scopeweaver/pull/89).

## Security

- The native bridge runtime pins `@opencode/*` 2.3.0 and `effect` 4.1.0, the version core 2.3.0 uses. The
  `zod` path that the default runtime validates through is now 4.6.7.

## Changed

- **Behavior change: the bridge and the server accept only native runtime 2.3.0.** A bridge still running
  2.1.4 is reported as an unsupported runtime. Restart the bridge after updating. The `legacy` 1.19.4
  runtime is unchanged.
- Runtime 2.3.0 reports the bridge's own interruption of a captured host tool as an `unknown` failure
  carrying `CAPTURE_INTERRUPTED` instead of `aborted`. The bridge accepts both shapes, and only after it
  interrupted the session itself; any other tool failure is still rejected as a protocol error.

## Known security issue

The advisory is only partly remediated, so [issue #67](https://github.com/cskwork/scopeweaver/issues/67)
stays open and `bun audit` still reports it:

- the `legacy` runtime's `@opencode-ai/plugin` 1.19.4 pins `zod` 4.1.8;
- `gitlab-ai-provider` 6.24.0, bundled by `@opencode/core` 2.3.0, still requires `zod ^3.25.76`, and no
  patched `zod` 3.x exists.

## Upgrade and verification

v0.9.2 adds no database migration and does not change the server's PostgreSQL schema, authentication or
LLM profiles. Only OpenCode SDK bridge profiles are affected; reinstall the bridge dependencies
(`bun install --frozen-lockfile` in `adapters/opencode-sdk`) and restart the bridge. Back up the PostgreSQL
database and data directory before upgrading.

Verified on the PR (macOS arm64, local): the adapter suite (`bun run check && bun test`) passed 63 of 63
against the real 2.3.0 CLI, compared with 58 of 63 before the interruption fix and 63 of 63 on 2.1.4; the
web unit tests passed 81 of 81. All required checks and `e2e` passed on the PR and on `dev`. Not verified:
a live provider call through the bridge, and the bridge on Linux (macOS arm64 only; Windows is unsupported).

## 한국어

선택 기능인 OpenCode SDK 브리지의 기본 `native` 런타임을 OpenCode CLI·클라이언트·SDK 2.1.4에서 2.3.0으로
올렸습니다. `@opencode/core`가 패치된 `zod` 4.6.7을 쓰므로 기본 런타임은 더 이상 `zod` 4.1.8로 검증하지
않습니다([GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5),
[#67](https://github.com/cskwork/scopeweaver/issues/67), [#89](https://github.com/cskwork/scopeweaver/pull/89)).

### 변경

- **동작 변경: 브리지와 서버는 native 런타임 2.3.0만 받습니다.** 2.1.4로 실행 중인 브리지는 지원하지 않는
  런타임으로 보고되므로 업데이트 후 브리지를 다시 시작하세요. `legacy` 1.19.4 런타임은 그대로입니다.
- 런타임 2.3.0은 브리지가 캡처한 호스트 도구를 직접 중단할 때 `aborted` 대신 `CAPTURE_INTERRUPTED`가 담긴
  `unknown` 실패를 보냅니다. 브리지는 자신이 세션을 중단한 경우에만 두 형태를 받아들이고, 그 밖의 도구
  실패는 이전처럼 프로토콜 오류로 거부합니다.

### 알려진 보안 문제

일부만 해결했으므로 [#67](https://github.com/cskwork/scopeweaver/issues/67)은 열어 두며 `bun audit`도 계속
보고합니다. `legacy` 런타임의 `@opencode-ai/plugin` 1.19.4가 `zod` 4.1.8을 고정하고, `@opencode/core`
2.3.0에 포함된 `gitlab-ai-provider` 6.24.0이 여전히 `zod ^3.25.76`을 요구하며, 패치된 `zod` 3.x는 없습니다.

### 업그레이드

데이터베이스 마이그레이션은 없습니다. OpenCode SDK 브리지 프로필만 영향을 받으며, `adapters/opencode-sdk`에서
`bun install --frozen-lockfile`로 의존성을 다시 설치한 뒤 브리지를 다시 시작하세요. 업그레이드 전에
PostgreSQL 데이터베이스와 데이터 디렉터리를 백업하세요.
