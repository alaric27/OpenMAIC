# LearnWeave 课堂模板扩展

本目录实现儿童英语教学、独立练习和素材播放的结构化生成及 Bundle 导出。启用 `LEARNWEAVE_EXTENSION_ENABLED=true` 后，Agent 注册 `lw_read_activities` / `lw_upsert_activity`；对应生成指导位于 `skills/agent-runtime/learnweave-english/SKILL.md`。关闭开关时不注册工具，专用 Bundle 返回404。内建工具 registry 中仍保留写工具的静态登记。

## 文件边界

- `contracts/generated.ts`：由相邻 LearnWeave 的 `packages/contracts/src/templates.ts` 生成，包含协议、能力类型及内置兼容定义，禁止手改；运行时目录以 LearnWeave 已发布标准接口为准。
- `contracts/template-bindings.ts`、`template-content-rule.ts`：由 LearnWeave 共享源码同步的通用校验与能力类型，禁止手改；LearnWeave 导入与 OpenMAIC 保存／导出复用同一套规则。
- `standards-client.ts`：读取 LearnWeave 已发布标准及历史版本，校验快照权威性；服务不可用时明确失败，不使用静态目录兜底。
- `templates.ts`：按共享规范选择已有页面绑定或通用单选构建器；按题干和选项能力组合生成原生 Slide + Quiz，正确答案仅存 Quiz，不按模板名称分支。
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

本次解耦保持三个既有源码接线点，不引入插件注册框架、不改变模板协议或迁移 SQL/checksum。复用已有能力新增活动标准时，在 LearnWeave 管理页面保存草稿并发布，无需在 OpenMAIC 增加模板枚举、名称分支或同步目录；协议和引擎能力变化仍需同步契约；新增交互能力仍需实现原生构建与 LearnWeave 执行支持。不能通过移除 owner/lease 校验或写工具登记来减少接线。目录集中和适配层降低维护范围，不承诺上游更新无需兼容检查。

## 2026-10-22 句型表达首段接线

`lw_read_activities` 现在同时返回 LearnWeave 生成的 `productionSpec` 和工具输入 Schema。`teaching.sentence-expression` 绑定已有课件，保存 `goal`、结构化 `data` 和 `notes`，不生成逐页公共教法。其生产说明与样例来自 LearnWeave 的生成契约；课堂教法、结束校验、记录和顺序推进属于 LearnWeave。

当前已验证实际工具保存、Bundle 导出与 LearnWeave 接入；整课生成质量、受控内容同步编辑和真实语音体验仍需单独验收。

## 2026-10-22 共享规范与通用构建

生产规范 revision=2，活动协议及 manifest 仍为 v1。输入 Schema、保留 ID、题目数量／选项范围／单答案规则、媒体绑定及禁用绑定均由 LearnWeave 提供。工具说明不再独立维护类型要求；TTS 触发、已有音频引用迁移和资源校验均读取共享内容规则，语义指纹保留对所有已有可选绑定字段的覆盖。源课程保存、权限、租约和 pending/ready 协议保持兼容。

布局坐标、原生 Slide／Quiz 创建、音频／图片元素和文字选项仍是 OpenMAIC 的构建能力。已有页面绑定与单选是当前支持的能力；新增能力不能仅添加配置就宣称可执行。契约测试通过注入新的活动 ID、音频题干＋文字选项组合及修改后的选项范围，验证构建和导出校验来自共享规则；该测试类型不属于正式发布目录。

## 2026-10-22 链路规则复查

生产规范 revision=3，新增 LearnWeave 拥有的教学控制、教法选择及播放执行能力声明。OpenMAIC 仅消费生产部分，课堂展示、答题门控、播放与结束仍由 LearnWeave 实现。题目数量、选项范围、文字与答案关系的共享校验同时用于生产前检查、Bundle 和 LearnWeave 导入；无效文字不会先触发 TTS。当前类型名称的特判只存在于 LearnWeave 的标准定义，生产工作流不另行维护一份类型要求。

原生 DSL 构建器、资源归属／格式校验及一致性保存是生产端职责，保留这些实现；共享规范不替代宿主的原生格式和资源权限检查。协议产物由 LearnWeave 同步，仍不得手改。


## 2026-10-22 可管理的已发布标准

配置 `LEARNWEAVE_API_URL`（默认 `http://127.0.0.1:3100`）。读取活动、upsert 和 Bundle 导出均请求 `/api/v1/template-standards`，返回当前发布目录及不可变版本历史。草稿不能用于生产；接口不可用或版本未知时明确失败。

`lw_read_activities` 返回 `standards`、当前生产规范和动态输入 Schema。新增活动默认使用当前发布版本，也可显式填写 `templateVersion`；编辑旧活动应根据作者意图保留原版本或完整升级。活动携带官方标准快照，保存和导出校验其内容与已发布版本一致。一个课程可以同时含同 ID 的多个标准版本。

网页管理支持现有能力组合、任务字段约束和标准专用教法；专用教法由 LearnWeave 执行。新标准 ID 不需要重部署 OpenMAIC；新增构建或课堂交互能力仍需要实现代码。正式生产不使用 `compiledStandards()` 兜底，该函数仅供隔离的单元测试构造基线。
