# LearnWeave 新课程生产扩展

启用 `LEARNWEAVE_EXTENSION_ENABLED=true` 后注册 `lw_read_activities` / `lw_save_course`。运行指导见 `skills/agent-runtime/learnweave-english/SKILL.md`。仅生产课程和素材；教法配置、实时课堂、活动推进和证据由 LearnWeave 管理。

## 生产流程

1. 通过原生工具创建/编辑 Stage 与 Scenes，先将素材保存至当前 owner 的素材库。
2. `lw_read_activities` 读取当前清单 revision、LearnWeave capability profile 与输入 schema。
3. `lw_save_course` 按 expectedRevision 显式保存完整 activities 清单，关联原生内容哈希和目标 profile。保持 owner、lease fence 和串行写调度。
4. `GET /api/learnweave/stages/:id/bundle` 返回 `learnweave.production@1`，核验读取前后版本、引用、能力、素材修订和哈希。

HTTP 编辑接口为 `GET/PUT /api/learnweave/stages/:id/activities`，PUT 接受 `{ expectedRevision, manifest }`。权限与原生课程一致。

- 200：新协议 Bundle。
- 404：扩展未启用或课程不可访问。
- 409：原生内容、目标能力或读取期间版本改变；显式重存清单后再导出。
- 422：缺少新清单、引用/能力/素材不通过；没有 204 和旧原生导出回退。
- 503：LearnWeave 生产规范服务不可用。

## 文件边界与依赖

扩展是随本仓库构建的普通 TypeScript 源码，不依赖 `@learnweave/*` npm 包、不引用相邻仓库，也不需要压缩包或包仓库。`client.ts` 负责固定的生产 HTTP 接口；`adapter.ts` 和 `media-adapter.ts` 隔离当前生产路径的宿主调用；`transport-types.ts` 只描述通信外壳，完整活动 Schema 和语义校验只有 LearnWeave 一份。`migrations.ts` 管理独立清单表。

生产服务默认是 `http://127.0.0.1:3100`，使用 `LEARNWEAVE_API_URL` 配置 HTTPS 或本机 HTTP 源站。普通 `pnpm install --frozen-lockfile` 即可安装本应用依赖，已取消共享包同步和 dev/build/start 的归档检查。

### HTTP API v1

- `GET /api/v1/course-production-spec`：完整 `authoringSchema`、`authoringSchemaHash`、DSL、Profile、已发布计划与模板。工具参数使用服务端下发的 Schema。
- `POST /api/v1/course-production/resolve`：提交 `{producerApiVersion:1, instanceId, targetProfileId, authoringSchemaHash, document, manifest}`，取得解析后的清单和 `documentHash`。
- `POST /api/v1/course-production/prepare`：提交 `{producerApiVersion:1, authoringSchemaHash, bundle}`，其中 bundle 为显式候选；服务端重算 `requiredCapabilities`、文档哈希、Bundle 哈希并完整校验。返回 `{producerApiVersion:1, authoringSchemaHash, bundle}`。

服务端准备是纯计算，不向源应用发起反向读取、不写入草稿/发布包、不调用模型。素材清单不代表字节已验收；LearnWeave 接入时继续下载并核实素材。

清单解析在数据库事务外进行，写入时保留 owner/lease fence 和 revision 检查，并重新核对原生文档修订。导出在远程准备前后核对文档、清单和素材版本；手动编辑后必须显式重存清单。版本不匹配返回 409，非法内容携带 422 诊断，服务故障返回 503，没有旧协议或本地旧 Schema 回退。生产服务不可用时仅注册读取/计划工具，原生工具保持可用，不暴露可写入的旧参数 Schema。

## 当前验证范围

源码扩展、数据迁移及启动 Schema 检查的 42 项测试、源仓库 TypeScript 检查与 Next 生产构建通过。LearnWeave 的隔离验收覆盖真实源应用清单保存、Bundle 导出、手动改页后拒绝旧清单、重存再导出和接入；同时覆盖接入、课堂预览、发布与原有课堂回归。验收不调用模型供应商，不据此宣称模型自主生成质量。LearnWeave 能力以实时 productionSpec.enabled 和已通过验收的子集为准。

在 LearnWeave 运行 `RUN_OPENMAIC_SOURCE_HTTP=1 pnpm exec playwright test -c playwright.production.config.ts` 可包含真实源扩展验收；需要先构建本仓库的 Next standalone 输出。测试在两个应用各自的临时数据库 schema 中执行并清理，不修改现有课程。

旧模板实现、生成契约及其历史测试已移除。已有数据通过一次性脚本迁为新清单草稿，必须检查配置并显式保存后才可导出。

### 后台课程节点计划

生产规范返回已发布 templates/templateVersions 与 plans/planVersions。调用 `lw_read_course_plan` 读取指定计划修订后，按节点 ID、顺序、目标及内容要求生成原生内容。`lw_save_course` 接受 `manifest.planSelection: {id, revision}`，验证节点序列并展开 pinned 模板、目标与结束策略；不允许用源端字段覆盖计划约束。单独选模板可用 `templateSelections`。导出时移除这些生产选择字段，运行时仅依赖已确定的活动定义；教学提示词正文由 LearnWeave 发布快照提供。


### 复用与上游升级

携带 `extensions/learnweave/`、`app/api/learnweave/`、`skills/agent-runtime/learnweave-english/`，并保留 runner 的工具注册和 stage-writer 的串行写注册。扩展课程迁移由扩展自身在使用时加载，不再修改宿主 schema-stores 注册。更换宿主版本时先检查适配层、工具上下文和官方 DSL，再跑 `learnweave-http-client`、`learnweave-production-http`、原生文档/素材边界及写调度测试。

兼容性按 HTTP API 版本、DSL、Schema 标识和目标 Profile 判断，不再比较两仓库完整源码哈希。工作台页面和原生编辑工具保持原样；新 DSL/运行能力仍须 LearnWeave 支持后才能发布。

### 模板场景与分类

模板 `id` 是编码，`sceneType` 沿用原生 `slide / quiz / interactive / pbl`；`category` 为 `teaching / practice / media`（教学／练习／音视频），只用于归类。生产 Agent 按模板 instructions 及 teachingProfileId 生成内容和 kind/data，服务端核对场景类型与教法，不根据编码或分类猜执行器。课堂活动协议保持独立：同一 slide 可以支持不同教学方式，媒体播放也可绑定展示 slide。

### 一次性旧数据迁移

先停止旧版本 OpenMAIC 写入，运行 `node scripts/migrate-learnweave-templates.mjs` 预演，再加 `--apply` 执行。脚本通过事务迁移旧表中尚无新清单的课程，保留原有新清单；完整旧记录、原生文档及迁移记录备份到 `~/.local/state/openmaic/backups/`，不进入仓库。成功后删除旧表和旧迁移账本，不保留启动兼容路径。重复执行无操作。

迁移保留课程和活动 ID、顺序、页面、题目及素材绑定，旧 instructions、提示和专用提示词进入 notes；旧快照完整保存在备份中。新教法按当前服务匹配，课程级别标为待配置，结束策略暂设允许跳过、五分钟上限；不猜测缺失的句型任务。所有迁入记录的 document_hash 为空，因此只可作为待检查草稿，导出返回 409，必须通过当前生产服务显式重存后使用。脚本不接入或发布课程。

### 单页组件场景

OpenMAIC 只在 `extensions/learnweave/components/` 保留通用接入层，组件实现、Schema、执行器和皮肤全部由 LearnWeave 持有：

- `production.ts` 注册 `lw_save_component_scene`，校验已发布组件引用、单任务内容和作者素材，复用宿主 owner/lease fence 与串行写入。
- 原生 TTS 返回的当前课堂 `/api/classroom-media/<stageId>/media/tts-*.mp3`（以及 wav/ogg）可直接填入音频素材字段。保存工具检查课堂所有权、路径、大小与真实格式，将音频导入作者素材库，再保存为素材 ID；同一工具上下文内复用已导入音频，不需要手工上传。跨课堂路径不接受。
- `media.ts` 注册 `lw_wait_component_media`，等待原生 `generate_video` 的真实结果；进程内注册表缺失时读取当前会话的持久化 `media_ready` 事件。占位引用不可保存为已完成内容。
- `definitions.ts` 从 LearnWeave 生产规范读取内容 Schema 和素材槽；`view.tsx` 通过 iframe 嵌入 LearnWeave 预览/编辑页，并检查回传消息的来源、窗口、预览 ID 和修订号。`editor-surface.tsx` 仍使用宿主 registry 注册通用入口。
- `hosted-previews.ts` 核验当前作者的素材权限，发出限时、限定素材及修订的读取票据；凭据不会跨站传递。缩略图由 LearnWeave 生成，经作者鉴权代理和浏览器缓存展示，不为列表项挂载 iframe。
- LearnWeave 不可用时展示明确提示，仍可通过通用 JSON 编辑并保存内容。OpenMAIC 不依赖任何具体组件 npm 包。

新增 `teaching-picture`（text/imageUrl/imageDescribe）及 `media-video`（videoUrl/videoDescribe）。字段只声明 string；不引入反馈 Schema、步骤配置或完成策略。旧四类场景维持原流程。

宿主接入点：DSL component 外壳和通用素材路径快照枚举、结构校验、场景分发/缩略图、编辑 surface 预加载、工具写入注册，以及读取组件上下文的安全分支。只读 fallback 保持原样；surface 可声明 supportsNarration=false，不开启原生脚本时间轴。升级宿主时回归这些入口和 `learnweave-component-*`、`learnweave-production-http` 测试。组件不支持的离线/PPTX 导出不能视为完整课堂导出。


### 模板元数据与展示代码的边界（2026-10-26 更新）

- Schema、素材字段、生成要求：从现有 LearnWeave HTTP productionSpec 获取。`GET /api/learnweave/components` 为当前作者提供纯数据的编辑器入口，遵守扩展开关，不含密钥或可执行代码。
- 通用保存工具接受 JSON 对象，以已发布模板 Schema 校验；素材槽使用相对 props 的 JSON pointer，支持数组通配符，例如 `/cards/*/picture`。不通过描述文字猜测素材。
- 新场景的 `content.assetSlots` 是工具生成的素材字段快照，不是教学内容，也不要求 AI 填写。宿主引用计数/存储/删除仅按快照扫描，不依赖 LearnWeave 在线；没有快照的 0.13 历史组件继续兼容原 imageUrl/videoUrl 字段。新的模板不再修改宿主扫描分支。
- 字段编辑、交互预览、版本判断和组件展示统一在 LearnWeave。新增组件只需在 LearnWeave 实现并注册；OpenMAIC 持续使用通用协议，不增加模板分支。
- 缩略图不挂载视频播放器，隐藏缩略图不发起素材加载。视频暂停/恢复沿用现有课堂状态；丢失进程内任务且没有持久化完成回执时返回不可确认，不自动重发付费任务。


### 教学节点与多个环节

`lw_read_course_plan` 支持 `schemaVersion: 2` 的教学节点配置：`value.nodes[].segments` 保留层级，顶层 `activities` 是服务端派生的生产顺序。按 `activities[].configuration.id` 创建活动，使用每项的配置及 `resolvedConfiguration`，保留 `nodeId`/`segmentId` 对应关系，保存时仍固定 `manifest.planSelection`。LearnWeave 权威解析目标、模板与覆盖，并在接入时恢复节点与环节。历史单模板计划的活动 ID 规则继续保持。

### 复用课程配置中的原课素材

调用 `lw_read_course_plan` 会为本轮工具集记录已读取的计划修订，`lw_save_component_scene` 自动沿用它，也可显式携带 `planSelection: {id, revision}`，将该已发布配置中明确出现的 HTTPS 素材 URL 转成当前作者素材库的引用，再保存场景。工具只读取模板声明的素材字段，支持嵌套数组字段，同一工具集中重复使用同一素材不会重复入库。下载、素材类型、大小、当前课程归属、任务租约与取消检查均在写入前执行。

原课素材优先通过配置所属 LearnWeave 服务的 `plan/:id/source-media` 获取。配置可用 `sourceMedia` 登记按哈希保存的原始字节；历史配置仍必须包含请求的精确原始 URL，才能读取后续发布登记的同一素材。未登记的素材走现有 HTTPS 公网下载校验，不扩大 `fetch_url` 的会话来源白名单。生成场景只保存作者素材引用，不保留外链作为运行依赖。

整课生成读取配置后，将 `planSelection` 同时传给组件保存工具及最终课程活动清单。单环节生产仅向组件工具传该参数，最终清单仍固定 `templateSelections` 与 `segmentConfigurations`，不得误用整课清单约束。遇到缺少配置参数时按错误指引重试，无需要求用户重新上传计划已有的素材。


## 独立内容生产任务（2026-11-02）

`POST /api/learnweave/production-jobs` 接收版本 1 的幂等请求（UUID key、prompt、固定活动与模板修订）；`GET /api/learnweave/production-jobs/:key` 查询同一任务，`POST .../:key/cancel` 请求取消。任务按作者隔离，先持久化唯一会话 ID 再创建 Agent 会话；响应丢失或并发重试不会建立第二个会话，相同 key 不接受不同输入。

`lw_save_course` 在导出检查通过并确认作者及租约后写入持久化产物回执。接口结果返回固定 stageId/source，接收方不再解析 Agent SSE 事件。

生产规范默认只返回当前模板和计划摘要。`productionSpec({templateSelections:[{id,revision}]})` 精确获取本任务模板；单独传 planSelection 读取该计划与依赖模板；同时指定模板及计划时仅附带已登记源素材信息，不展开整课。`lw_read_activities` 可传 templateSelections，`lw_read_course_plan` 在选定计划后再获取详情。已有修订仍可按明确引用读取，默认不发送整份历史。

升级时两个仓库一起更新并重启；持久化表由扩展 Schema migrations 管理。`tests/agent-runtime/learnweave-production-jobs.test.ts` 覆盖幂等、并发、响应丢失、归属与产物保存；传入隔离测试数据库连接运行数据库部分。
