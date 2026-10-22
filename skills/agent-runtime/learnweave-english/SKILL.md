---
name: learnweave-english
title: 儿童英语模板课
description: 为 LearnWeave 制作有明确教学、练习和素材播放节点的儿童英语课程。需要可点击的听音选图、看图选词及模板化导出时使用。
---

# 儿童英语模板课

LearnWeave 定义课程结构、活动标准和教法；这里负责按规范生产内容、编辑并交付 Bundle。

1. 用 create_stage 建立课程后，先调用 lw_read_activities。读取已发布 standards（含准确版本）、productionSpec、activityInput 和当前 revision；使用其中当前支持的目录、字段与样例，不凭记忆选择活动类型。
2. 根据作者的主题、水平、目标和建议时长，规划有序活动清单。按独立任务划分活动；同一任务的追问、提示和示范可以留在活动内。作者确认后再批量生产素材。
3. 按返回的规范生成或复用原生课件与正式素材，用 lw_upsert_activity 登记完整活动清单。activityId 在编辑和重试时保持不变，order 是从 0 开始的唯一课堂顺序。
4. 按返回的 Schema 和内容能力声明填写目标、任务数据、备注与素材绑定。共享教法由 LearnWeave 提供，不能把整段课堂提示词复制进 instructions；不要在工作流中另行维护活动类型清单或字段要求。练习答案只保存在原生 Quiz。
5. 素材使用真实保存引用。规范要求音频题干且缺少音频时优先提供 promptText 以合成保存；已有 audioSrc 必须是已保存的音频，或同课 /api/classroom-media/ 地址。不得把图片 ID 当音频，不能用 HTML 游戏冒充可执行练习。
6. 每次更新使用刚读到的 expectedRevision。新增活动采用当前已发布标准版本；编辑旧活动时根据作者意图显式保留 templateVersion 或按新版字段完整升级，不把新旧版本混用。REVISION_CONFLICT 时重读再试；retryable:false 必须按 field / nextAction 修正输入。素材错误不能靠重读 revision 解决；repeatedInput:true 时停止重复原参数。不得换 activityId 绕过失败而追加重复节点。
7. 修改内容时同步更新任务数据和关联课件，检查示范音频是否仍适用；纯排版修改不改变任务。对改动后的活动重新保存并校验，不能仅凭素材链接还有效就认定一致。
8. 最后读取活动，确认全部 ready、类型与顺序符合规范，再导出 Bundle。原生课件预览用于检查内容和版式；交互、实时老师、收音、判题、暂停恢复及整课体验在 LearnWeave 中验证。

工具不存在时说明该部署尚未启用 LearnWeave 扩展，不能用普通课件伪装成可操作课程。课程按发布顺序执行，上课时的学生回答、帮助和进度由 LearnWeave 管理。
