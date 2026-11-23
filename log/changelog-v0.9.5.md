# ScopeWeaver v0.9.5 — Shutdown logging and chat readiness

[English](#english) · [한국어](#한국어) · [简体中文](#简体中文) · [繁體中文](#繁體中文) · [日本語](#日本語) · [Español](#español)

## English

### Fixes

- **Frontend security** ([#99]): update Next.js **16.4.3 → 16.4.5** for [GHSA-mfr8-8qww-v76h][advisory]. Frontend dependency audit findings decreased **1 → 0**; this count covers the frontend dependency graph only.
- **Shutdown logging** ([#100]): blocked log `INSERT`s use an explicit transaction so rollback prevents late autocommit after cancellation. An already in-flight `COMMIT` can still have an uncertain outcome.
- **Existing-conversation loading** ([#102]): show the loading state while the first conversation list is pending. This prevents an editable temporary new-chat composer from being replaced by an empty conversation composer with Send disabled.
- **Context browser checks** ([#101]): wait for the composer to clear and render before clicking the context trigger. Existing assertions and timeouts are retained.

Related [#94] remains open; some historical CI failure sequences are still unconfirmed.

### Upgrade and verification

No database schema migration, production configuration, public API or OpenCode runtime change. Back up the PostgreSQL database and data directory before upgrading.

Code promotion [#103] at [e284116][main] passed **7/7 required checks on attempt 1** ([checks], [e2e]). The `draft` suite **12/12**, `standard` suite **122/122** and **3 targeted logsink regressions** passed. The release-notes PR checks and subsequent `dev`/`main` checks must still pass before tagging v0.9.5.

## 한국어

### 수정

- **프런트엔드 보안** ([#99]): [GHSA-mfr8-8qww-v76h][advisory] 대응을 위해 Next.js를 **16.4.3 → 16.4.5**로 올렸습니다. 프런트엔드 의존성 감사 항목은 **1 → 0건**이며, 이 수치는 프런트엔드 의존성 범위에 한정됩니다.
- **종료 시 로그 저장** ([#100]): 잠금에 막힌 로그 `INSERT`를 명시적 트랜잭션으로 처리하여, 취소 후 늦게 잠금이 풀려도 롤백으로 자동 커밋을 막습니다. 이미 진행 중인 `COMMIT`의 결과는 불확실할 수 있습니다.
- **기존 대화 로딩** ([#102]): 첫 대화 목록을 불러오는 동안 로딩 상태를 표시합니다. 임시 새 대화 입력창에 입력한 내용이 빈 기존 대화 입력창으로 교체되고 전송 버튼이 비활성화되는 경로를 막습니다.
- **문맥 브라우저 검사** ([#101]): 입력창 내용이 비워지고 화면에 반영된 뒤 문맥 버튼을 클릭합니다. 기존 검증 조건과 제한 시간은 유지했습니다.

관련 [#94]는 계속 열려 있으며, 일부 과거 CI 실패의 정확한 발생 순서는 아직 확인되지 않았습니다.

### 업그레이드와 검증

데이터베이스 스키마 마이그레이션, 운영 설정, 공개 API, OpenCode 런타임 변경은 없습니다. 업그레이드 전에 PostgreSQL 데이터베이스와 데이터 디렉터리를 백업하세요.

코드 승격 [#103]의 [e284116][main]에서 **필수 검사 7/7개가 첫 실행에 통과**했습니다([checks], [e2e]). `draft` suite **12/12**, `standard` suite **122/122**, **로그 저장(logsink) 회귀 검사 3개**도 통과했습니다. v0.9.5 태그를 만들기 전에 릴리즈 노트 PR 검사와 이후 `dev`/`main` 검사를 추가로 통과해야 합니다.

## 简体中文

### 修复

- **前端安全**（[#99]）：针对 [GHSA-mfr8-8qww-v76h][advisory]，将 Next.js 从 **16.4.3 升级至 16.4.5**。前端依赖审计发现项从 **1 项降为 0 项**；此数字仅涵盖前端依赖图。
- **关闭时保存日志**（[#100]）：被锁阻塞的日志 `INSERT` 使用显式事务，取消后通过回滚阻止延迟自动提交。对于已经在进行中的 `COMMIT`，其结果仍可能不确定。
- **加载已有会话**（[#102]）：等待首次会话列表响应时显示加载状态，防止用户在临时新会话输入框中输入后，该输入框被空白的已有会话输入框替换，并导致发送按钮禁用。
- **上下文浏览器检查**（[#101]）：等待输入框清空并完成渲染后再点击上下文按钮。保留原有断言和超时时间。

相关问题 [#94] 仍保持开放；部分历史 CI 失败的事件顺序尚未确认。

### 升级与验证

无需迁移数据库架构，也未更改生产配置、公共 API 或 OpenCode 运行时。升级前请备份 PostgreSQL 数据库和数据目录。

代码晋升 [#103] 的 [e284116][main] 在**首次运行中通过了全部 7/7 项必需检查**（[checks]、[e2e]）。`draft` 测试套件 **12/12**、`standard` 测试套件 **122/122** 及 **3 项 logsink 专项回归检查**均已通过。创建 v0.9.5 标签前，仍须通过发布说明 PR 检查及其后续的 `dev`/`main` 检查。

## 繁體中文

### 修正

- **前端安全**（[#99]）：針對 [GHSA-mfr8-8qww-v76h][advisory]，將 Next.js 從 **16.4.3 升級至 16.4.5**。前端相依套件稽核發現項目從 **1 項降為 0 項**；此數字僅涵蓋前端相依套件圖。
- **關閉時儲存日誌**（[#100]）：遭鎖定阻塞的日誌 `INSERT` 使用明確交易，取消後透過回復交易阻止延遲自動提交。對於已在進行中的 `COMMIT`，其結果仍可能不確定。
- **載入既有對話**（[#102]）：等待首次對話清單回應時顯示載入狀態，防止使用者在暫時的新對話輸入框中輸入後，該輸入框被空白的既有對話輸入框取代，並導致傳送按鈕停用。
- **上下文瀏覽器檢查**（[#101]）：等待輸入框清空並完成呈現後，再點擊上下文按鈕。保留原有斷言與逾時時間。

相關問題 [#94] 仍未關閉；部分過往 CI 失敗的事件順序尚未確認。

### 升級與驗證

無須遷移資料庫結構，也未變更正式環境設定、公開 API 或 OpenCode 執行階段。升級前請備份 PostgreSQL 資料庫與資料目錄。

程式碼晉升 [#103] 的 [e284116][main] 在**首次執行中通過全部 7/7 項必要檢查**（[checks]、[e2e]）。`draft` 測試套件 **12/12**、`standard` 測試套件 **122/122** 與 **3 項 logsink 專項回歸檢查**均已通過。建立 v0.9.5 標籤前，仍須通過版本說明 PR 檢查及其後續的 `dev`/`main` 檢查。

## 日本語

### 修正

- **フロントエンドのセキュリティ**（[#99]）：[GHSA-mfr8-8qww-v76h][advisory] に対応するため、Next.js を **16.4.3 から 16.4.5** に更新しました。フロントエンド依存関係の監査指摘は **1 件から 0 件**になりました。この件数の対象はフロントエンドの依存関係のみです。
- **終了時のログ保存**（[#100]）：ロック待ちのログ `INSERT` を明示的なトランザクションで実行し、キャンセル後の遅延自動コミットをロールバックで防ぎます。すでに処理中の `COMMIT` の結果は、なお不確定な場合があります。
- **既存の会話の読み込み**（[#102]）：最初の会話一覧の応答を待つ間は読み込み状態を表示します。一時的な新規会話入力欄への入力後に、空の既存会話入力欄へ置き換わり、送信ボタンが無効になる経路を防ぎます。
- **コンテキストのブラウザ検証**（[#101]）：入力欄が空になり、画面に反映されてからコンテキストボタンをクリックします。既存のアサーションとタイムアウトは維持しています。

関連する [#94] は引き続きオープンです。一部の過去の CI 失敗については、発生時の処理順をまだ確認できていません。

### アップグレードと検証

データベーススキーマの移行、本番環境設定、公開 API、OpenCode ランタイムの変更はありません。アップグレード前に PostgreSQL データベースとデータディレクトリをバックアップしてください。

コード昇格 [#103] の [e284116][main] は、**初回実行で必須チェック 7/7 件に合格**しました（[checks]、[e2e]）。`draft` スイート **12/12**、`standard` スイート **122/122**、**logsink の対象回帰検証 3 件**も合格しています。v0.9.5 のタグ作成前に、リリースノート PR のチェックと、その後の `dev`/`main` のチェックに合格する必要があります。

## Español

### Correcciones

- **Seguridad del frontend** ([#99]): Next.js se actualiza de **16.4.3 a 16.4.5** para corregir [GHSA-mfr8-8qww-v76h][advisory]. Los hallazgos de la auditoría de dependencias del frontend bajan de **1 a 0**; esta cifra solo abarca su grafo de dependencias.
- **Guardado de registros al cerrar** ([#100]): los `INSERT` de registros bloqueados usan una transacción explícita; la reversión evita una confirmación automática tardía tras la cancelación. El resultado de un `COMMIT` que ya estaba en curso puede seguir siendo incierto.
- **Carga de conversaciones existentes** ([#102]): se muestra el estado de carga mientras llega la primera lista de conversaciones. Así se evita que el usuario escriba en un editor temporal de nueva conversación que luego se sustituye por el editor vacío de la conversación existente, con Enviar desactivado.
- **Comprobaciones de contexto en el navegador** ([#101]): se espera a que el editor se vacíe y se actualice en pantalla antes de pulsar el botón de contexto. Se conservan las aserciones y los tiempos de espera existentes.

El seguimiento [#94] sigue abierto; algunas secuencias de los fallos históricos de CI siguen sin confirmarse.

### Actualización y verificación

No hay migraciones del esquema de base de datos ni cambios de configuración de producción, API pública o entorno de ejecución de OpenCode. Antes de actualizar, haga una copia de seguridad de la base de datos PostgreSQL y del directorio de datos.

La promoción de código [#103] en [e284116][main] superó **las 7/7 comprobaciones obligatorias en el primer intento** ([checks], [e2e]). También pasaron la suite `draft` **12/12**, la suite `standard` **122/122** y **3 comprobaciones de regresión específicas de logsink**. Antes de etiquetar v0.9.5, aún deben pasar las comprobaciones del PR de notas de versión y las posteriores de `dev`/`main`.

[#94]: https://github.com/cskwork/scopeweaver/issues/94
[#99]: https://github.com/cskwork/scopeweaver/pull/99
[#100]: https://github.com/cskwork/scopeweaver/pull/100
[#101]: https://github.com/cskwork/scopeweaver/pull/101
[#102]: https://github.com/cskwork/scopeweaver/pull/102
[#103]: https://github.com/cskwork/scopeweaver/pull/103
[advisory]: https://github.com/advisories/GHSA-mfr8-8qww-v76h
[main]: https://github.com/cskwork/scopeweaver/commit/e2841162939b8c7a7f06ea613da5bf8c9873eee4
[checks]: https://github.com/cskwork/scopeweaver/actions/runs/44023347919
[e2e]: https://github.com/cskwork/scopeweaver/actions/runs/44023347980
