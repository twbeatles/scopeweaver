# ScopeWeaver v0.9.6 — Report integrity and provider profiles

[English](#english) · [한국어](#한국어) · [简体中文](#简体中文) · [繁體中文](#繁體中文) · [日本語](#日本語) · [Español](#español)

## English

- Run `scripts/report_integrity_check.py` to verify finding counts and headings in a Markdown report. Supply `--appendix` to check a CVSS appendix. CI runs 15 regression tests for the command. [#109]
- New LLM profiles can use the Cheaper Inference preset with `gpt-5.4-mini`. The app prevents API key reuse when switching to or from this gateway across origins. The connection test uses the selected Chat Completions token-limit field. [#110]
- The pre-commit hook runs Biome on staged web JavaScript and TypeScript files and preserves working files with unstaged edits. Removing `lint-staged` dropped the affected `picomatch` dependency. The frontend audit reported zero vulnerabilities. [#111] · [Advisory][advisory]

The integrated `dev` commit and the promotion PR each passed all 7 required checks, including browser smoke and chat-browser. Provider checks used loopback HTTP and disposable PostgreSQL. [CI] · [E2E] · [#113]

## 한국어

- `scripts/report_integrity_check.py`로 Markdown 보고서의 발견 항목 수와 제목을 검사할 수 있습니다. CVSS 부록은 `--appendix`로 지정합니다. CI에서 명령의 회귀 테스트 15개를 실행합니다. [#109]
- 새 LLM 프로필에서 `gpt-5.4-mini`를 사용하는 Cheaper Inference 프리셋을 선택할 수 있습니다. 게이트웨이로 들어가거나 나갈 때 주소의 출처가 달라지면 API 키 재사용을 막습니다. 연결 테스트는 설정에서 선택한 Chat Completions 토큰 한도 필드를 사용합니다. [#110]
- 커밋 전 훅은 스테이징된 웹 JavaScript·TypeScript 파일을 Biome으로 검사하고, 아직 스테이징하지 않은 변경이 있는 작업 파일을 보존합니다. `lint-staged`를 제거해 취약한 `picomatch` 의존성이 빠졌습니다. 프런트엔드 감사에서 취약점 0건을 확인했습니다. [#111] · [보안 권고][advisory]

통합 `dev` 커밋과 승격 PR에서 브라우저 스모크 및 채팅 브라우저 검사를 포함한 필수 체크 7개가 모두 통과했습니다. 공급자 검증에는 루프백 HTTP와 임시 PostgreSQL을 사용했습니다. [CI] · [E2E] · [#113]

## 简体中文

- 使用 `scripts/report_integrity_check.py` 检查 Markdown 报告中的发现项数量和标题。使用 `--appendix` 指定 CVSS 附录。CI 对该命令运行 15 项回归测试。 [#109]
- 新建 LLM 配置文件时可选用基于 `gpt-5.4-mini` 的 Cheaper Inference 预设。切换到该网关或离开该网关时，如果端点源发生变化，应用会阻止复用 API 密钥。连接测试使用所选的 Chat Completions 令牌上限字段。 [#110]
- 提交前钩子使用 Biome 检查已暂存的 Web JavaScript 和 TypeScript 文件，并保留含有未暂存更改的工作文件。移除 `lint-staged` 后，受影响的 `picomatch` 依赖已不再使用。前端审计发现 0 个漏洞。 [#111] · [安全公告][advisory]

集成后的 `dev` 提交和晋升 PR 均通过 7 项必需检查，其中包括浏览器冒烟测试和聊天浏览器测试。提供商检查使用回环 HTTP 和临时 PostgreSQL 数据库。 [CI] · [E2E] · [#113]

## 繁體中文

- 使用 `scripts/report_integrity_check.py` 檢查 Markdown 報告中的發現項目數量與標題。使用 `--appendix` 指定 CVSS 附錄。CI 對這個命令執行 15 項回歸測試。 [#109]
- 新增 LLM 設定檔時可選用基於 `gpt-5.4-mini` 的 Cheaper Inference 預設。切換至該閘道或離開該閘道時，若端點來源改變，應用程式會阻止重複使用 API 金鑰。連線測試使用所選的 Chat Completions 權杖上限欄位。 [#110]
- 提交前掛鉤使用 Biome 檢查已暫存的 Web JavaScript 與 TypeScript 檔案，並保留含有未暫存變更的工作檔案。移除 `lint-staged` 後，已排除受影響的 `picomatch` 相依套件。前端稽核發現 0 個弱點。 [#111] · [安全公告][advisory]

整合後的 `dev` 提交和升版 PR 均通過 7 項必要檢查，包括瀏覽器冒煙測試與聊天瀏覽器測試。供應商檢查使用迴路 HTTP 與暫用 PostgreSQL 資料庫。 [CI] · [E2E] · [#113]

## 日本語

- `scripts/report_integrity_check.py` で Markdown レポートの検出項目数と見出しを検証できます。CVSS 付録を確認するには `--appendix` で指定します。CI ではこのコマンドの回帰テストを 15 件実行します。 [#109]
- 新しい LLM プロファイルで `gpt-5.4-mini` を使う Cheaper Inference プリセットを選択できます。このゲートウェイへの切り替えや他の接続先への切り替えでオリジンが変わる場合、API キーの再利用を防ぎます。接続テストは選択した Chat Completions のトークン上限フィールドを使います。 [#110]
- コミット前のフックはステージ済みの Web JavaScript・TypeScript ファイルを Biome で検証し、未ステージの変更がある作業ファイルを保持します。`lint-staged` を削除し、影響を受ける `picomatch` 依存関係を取り除きました。フロントエンドの監査結果は脆弱性 0 件です。 [#111] · [セキュリティ情報][advisory]

統合後の `dev` コミットと昇格 PR はいずれも、ブラウザーのスモークテストとチャットのブラウザーテストを含む必須チェック 7 件に合格しました。プロバイダーの検証にはループバック HTTP と一時 PostgreSQL データベースを使いました。 [CI] · [E2E] · [#113]

## Español

- Use `scripts/report_integrity_check.py` para comprobar el recuento y los encabezados de los hallazgos de un informe Markdown. Indique el apéndice CVSS con `--appendix`. La CI ejecuta 15 pruebas de regresión del comando. [#109]
- Los perfiles de LLM nuevos pueden usar el preajuste de Cheaper Inference con `gpt-5.4-mini`. Al entrar en esta pasarela o salir de ella hacia otro origen, la aplicación impide reutilizar la clave de API. La prueba de conexión usa el campo seleccionado para limitar los tokens de Chat Completions. [#110]
- El gancho de pre-commit usa Biome para comprobar los archivos web JavaScript y TypeScript preparados y conserva los archivos de trabajo con cambios sin preparar. Al retirar `lint-staged` se eliminó la dependencia afectada de `picomatch`. La auditoría del frontend detectó 0 vulnerabilidades. [#111] · [Aviso de seguridad][advisory]

El commit integrado en `dev` y el PR de promoción superaron las 7 comprobaciones obligatorias, incluidas la prueba básica en navegador y la prueba del chat en navegador. Las pruebas del proveedor usaron HTTP de bucle local y PostgreSQL temporal. [CI] · [E2E] · [#113]

[#109]: https://github.com/cskwork/scopeweaver/pull/109
[#110]: https://github.com/cskwork/scopeweaver/pull/110
[#111]: https://github.com/cskwork/scopeweaver/pull/111
[#113]: https://github.com/cskwork/scopeweaver/pull/113
[advisory]: https://github.com/advisories/GHSA-fc5q-39xc-vjpf
[CI]: https://github.com/cskwork/scopeweaver/actions/runs/44212861990
[E2E]: https://github.com/cskwork/scopeweaver/actions/runs/44212861901
