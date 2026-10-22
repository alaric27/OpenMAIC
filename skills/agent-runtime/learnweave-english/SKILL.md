---
name: learnweave-english
title: 儿童英语模板课
description: 为 LearnWeave 制作有明确教学、练习和素材播放节点的儿童英语课程。需要可点击的听音选图、看图选词及模板化导出时使用。
---

# 儿童英语模板课

先规划一条短而连续的活动路线。三大类为 teaching、practice、media；小类型仅使用工具声明支持的模板。

1. 用 create_stage 建立课程，生成或复用必要素材。教学页与播放页可用原生 generate_scene / patch_stage 构建；图片使用 generate_image 返回的真实保存素材 ID。
2. 每个活动先调用 lw_read_activities 获取最新 revision，首次为空时 expectedRevision 为 0。
3. 使用 lw_upsert_activity 登记完整路线，activityId 在改课和重试时保持不变，order 为从 0 开始的活动顺序。
4. 看图教学使用 teaching.picture-talk，绑定已保存的 contentRef；instructions 只写当前教学目标、短句与提问要求。
5. 听音选图使用 practice.listen-image：给每个选项提供真实图片 imageSrc、唯一 value、作者标签 label、正确 answer，优先只提供 promptText，由工具合成并保存正式音频；复用时 audioSrc 必须是已保存的音频素材 ID、正式素材地址或同一课程的 /api/classroom-media/ 音频地址（工具自动转存）。图片素材 ID 不能用作音频。不要用生成的 HTML 游戏代替该工具。
6. 看图选词使用 practice.image-word：提供真实题干 imageSrc、文字选项及 answer。
7. 独立播放使用 media.audio / media.video，绑定已有 contentRef 和 mediaElementId。教学内的一次短示范仍属于教学，不另切播放模板。
8. hints 最多三级，maxAttempts 默认建议 3。两种练习由程序判题和推进，无需老师持续在线；不要把答案写进教学台词。
9. 每个更新使用刚读取的 expectedRevision；仅 REVISION_CONFLICT 需要重读并更新 expectedRevision。retryable:false 时必须按 field / nextAction 修改参数或修复依赖后再调用；repeatedInput:true 表示相同错误已被拦截，停止无效重试。素材错误不能通过重读 revision 解决；缺少有效音频时删除 audioSrc，仅提供 promptText。无法修复时报告阻塞。不能改 activityId 绕过失败而追加重复节点。
10. 课程第一环节通常为教学欢迎；交替组织短教学、练习组和必要素材。零基础每轮一至两句、只问一个问题，接受单词起步。跟读与提示后作答不能宣称独立掌握。
11. 最后再次读取活动，确认全部 ready，检查三类节点的顺序。原生课件预览是视觉预览；可点击交互在 LearnWeave 接入后的预览中验证。

工具不存在时说明该部署尚未启用 LearnWeave 扩展，不能用普通课件伪装成交付了可操作模板。
