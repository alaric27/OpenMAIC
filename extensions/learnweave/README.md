# LearnWeave 课堂模板扩展

本目录实现儿童英语教学、独立练习和素材播放的结构化生成及 Bundle 导出。启用 `LEARNWEAVE_EXTENSION_ENABLED=true` 后，Agent 注册 `lw_read_activities` / `lw_upsert_activity`；对应生成指导位于 `skills/agent-runtime/learnweave-english/SKILL.md`。关闭开关时不注册工具，专用 Bundle 返回404。内建工具 registry 中仍保留写工具的静态登记。

## 文件边界

- `contracts/generated.ts`：由相邻 LearnWeave 的 `packages/contracts/src/templates.ts` 生成，禁止手改。
- `templates.ts`：五个模板的构建器。练习构建原生 Slide + Quiz，正确答案仅存 Quiz；教学和播放绑定已有场景。
- `validate.ts`：题型、资源绑定及稳定语义指纹。版式修改不改变语义指纹，答案或绑定资源修改需重存模板。
- `index.ts`：工具入参和模板保存流程；权限、调度及素材检查交给适配层。
- `adapter.ts`：集中调用 OpenMAIC 内部身份、文档、权限、调度和存储接口，上游接口变化优先检查此文件。工具包装按需加载，`buildLearnWeaveTools` 返回 Promise，由 runner 等待完成后注册。
- `config.ts`：独立功能开关，路由无需导入工具入口。
- `migrations.ts`：纯迁移定义，供启动版本检查使用，不加载运行时存储或生成工具。
- `store.ts`：独立附属表读写、revision CAS、pending/ready 写入；原生保存失败时保持 pending，使用同 activityId 读取新 revision 后重试。
- `media.ts`：可选 TTS 适配，仅缺少 `audioSrc` 且提供 `promptText` 时动态加载；复用供应商授权及素材存储。使用已有音频不调用 TTS。
- `export.ts`：owner 范围内一致性检查及 Bundle 输出；薄路由位于 `app/api/learnweave/stages/[id]/bundle/route.ts`。

既有源码仅有三个接线文件：

1. `lib/server/agent-runtime/runner.ts`：注册工具并加入允许列表，传入 owner store 和当前租约 fence。
2. `lib/agent-runtime/stage-writer-tools.ts`：登记 `lw_upsert_activity`，复用写入串行调度。
3. `lib/persistence/schema-stores.ts`：登记附属表迁移。

另更新工具 registry 和迁移 checksum 的既有测试。未修改公共 DSL、SDK、原生课程接口或通用课件渲染器。首次上线迁移仍遵循现有迁移机制；关闭开关不会删除已有模板数据。

## 工具与导出

先读活动获得 revision；首次为空时 expectedRevision=0。upsert 使用固定 activityId 和从0开始的 order，每次操作可使 revision 增长两次，以返回值为准。选项 value 唯一，听音选图绑定每个选项的真实图片；资源需为当前 owner 的已保存素材。`promptText` 可调用 TTS，已有 `audioSrc` 优先复用。教学及播放使用已存在的 contentRef，独立媒体还需 mediaElementId。

保存顺序为 pending → 原生文档 → 重新加载校验 → ready。两个存储不冒充跨库原子事务：发生失败时 pending 不能导出，调用方读取当前 revision 并用原 activityId 重试。生成场景ID稳定，避免重试追加重复题。

`GET /api/learnweave/stages/:id/bundle` 保留现有身份鉴权：

- 200：`{document, learning, nativeRevision}`，原生版本、扩展版本及指纹一致。
- 204：已有普通课程尚无模板，调用方可走原生课程接口。
- 404：未启用扩展或无权限/课程不存在。
- 409：保存未完成、原生题目/绑定发生变化或读取时并发更新；修复保存后重试，不应静默降级。

原生 Slide 是视觉预览，可点击图片/单词练习由 LearnWeave 渲染。模板语音策略由 LearnWeave 根据类型执行，不依靠老师模型猜测。

## 验证与同步上游

在 LearnWeave 仓库执行 `pnpm templates:sync`，再执行 `node scripts/sync-template-contracts.cjs --check`。可用 `OPENMAIC_REPO` 指定目标仓库。两个仓库需协同检查契约变更，升级模板版本不能覆盖已发布的课堂快照。

OpenMAIC 最小回归：

```sh
pnpm exec tsc --noEmit --incremental false
pnpm exec vitest run tests/agent-runtime/learnweave-templates.test.ts tests/agent-runtime/learnweave-adapter.test.ts tests/agent-runtime/stage-writer-registry.test.ts tests/persistence/schema-migration-checksums.test.ts
pnpm build
```

本机配置文件若引用未提供的环境变量，测试会被供应商配置初始化阻挡；可用 `OPENMAIC_CONFIG` 指向只含 `{}` 的临时 YAML，勿打印凭证。真实数据库 fixture `tests/agent-runtime/learnweave-fixture.local.test.ts` 默认跳过，由 LearnWeave 的 `e2e/templates.spec.ts` 提供本地输入文件并执行；普通单元测试不应自动写库。

本轮基线为 `6e20534fe01e21c69363571b737e3a61f993b3f0`。同步上游时重点检查三个接线点、owner/lease wrapper、asset store、原生 save/load 与迁移机制。依靠仓库真实冲突解决，不把扩展目录误认为已有通用插件框架。工具与保存链路已验收，模型自主规划和整课生成质量仍需单独验证。

本次解耦保持三个既有源码接线点，不引入插件注册框架、不改变模板协议或迁移 SQL/checksum。新增模板优先修改本目录；不能通过移除 owner/lease 校验或写工具登记来减少接线。目录集中和适配层降低维护范围，不承诺上游更新无需兼容检查。
