# ScopeWeaver v0.9.4 — Paused tasks stay paused when the server is rebuilt

## Fixed

- **Paused tasks no longer run planner rounds after the server is rebuilt in the same process**
  ([#94](https://github.com/cskwork/scopeweaver/issues/94), [#95](https://github.com/cskwork/scopeweaver/pull/95)).
  Restoring task runtimes reapplied a saved pause only to tasks that were newly loaded from storage. When a
  server was rebuilt on a task manager that already held its tasks, those tasks were started without their
  pause, so a paused task ran a planner round immediately and again on every 600-second heartbeat, sending
  model requests the user had paused. Every paused task is now paused before its loop starts. A normal restart
  builds a fresh task manager and already restored the pause, so its behavior is unchanged.

## Tests

- The browser chat test (`TestChatControlsE2E`) no longer fails intermittently on queue order, `/context`
  provider calls or cross-segment execution; the paused-task planner requests above were leaking into the
  fixture's request log. It also waits for the conversation composer before typing steering input, instead of
  typing into the draft composer that the page replaces. One intermittent failure (a context popover that did
  not open in `zh-Hant/1440/task`) was not reproduced and remains open in #94.

## Upgrade and verification

No database migration, configuration, API or OpenCode SDK bridge change. Back up the PostgreSQL database and
data directory before upgrading.

Verified on the fix: the browser chat test passed 127 of 127 twice locally against a disposable PostgreSQL
database with no planner requests from paused tasks; before the fix, the queue suite reproduced the
`queued execution order changed` failure with 144 such requests. All required checks and `e2e` passed on the
PR and on `dev`, and must pass again on `main` before tagging.

## 한국어

### 수정

- **같은 프로세스에서 서버를 다시 만들어도 일시정지된 작업이 planner를 실행하지 않습니다**
  ([#94](https://github.com/cskwork/scopeweaver/issues/94), [#95](https://github.com/cskwork/scopeweaver/pull/95)).
  작업 런타임을 복원할 때 저장된 일시정지를 저장소에서 새로 불러온 작업에만 다시 적용했습니다. 작업을 이미 들고
  있는 작업 관리자 위에 서버를 다시 만들면 이 작업들이 일시정지 없이 시작되어, 곧바로 그리고 600초 하트비트마다
  planner를 실행하고 사용자가 멈춘 모델 요청을 보냈습니다. 이제 모든 일시정지 작업을 루프 시작 전에 일시정지합니다.
  일반 재시작은 새 작업 관리자를 만들고 이미 일시정지를 복원했으므로 동작이 같습니다.

### 테스트

- 브라우저 채팅 테스트(`TestChatControlsE2E`)가 대기열 순서, `/context` 제공자 호출, 다른 세그먼트 실행 검사에서
  간헐적으로 실패하던 문제를 고쳤습니다. 위의 일시정지 작업 planner 요청이 fixture 요청 기록에 섞인 것이 원인이었습니다.
  조정 입력도 페이지가 교체하는 임시 입력창이 아니라 실제 대화 입력창을 기다린 뒤 입력합니다. `zh-Hant/1440/task`에서
  문맥 팝오버가 열리지 않은 간헐 실패 1건은 재현되지 않아 #94에서 계속 추적합니다.

### 업그레이드

데이터베이스 마이그레이션, 설정, API, OpenCode SDK 브리지 변경은 없습니다. 업그레이드 전에 PostgreSQL 데이터베이스와
데이터 디렉터리를 백업하세요.
