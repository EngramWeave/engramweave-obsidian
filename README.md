# EngramWeave for Obsidian

在 Obsidian 原生编辑 Draft，右侧查看 Source Annotation、Review Analyzer 与 Relation Analyzer。用统一 Review Note 创建 Idea、提交 Recompile 反馈或确认 Review Complete；也可通过独立 MVP 入口明确新建 `40_Knowledge` 笔记。Core 负责模型执行、状态、文件保护和恢复，插件不改写分析输出到正文。

本插件面向 Windows 本地 Vault。Source 可以有多份独立保留的 Draft；Review Complete 明确选择其中一份进入规划，每份 Draft 自己拥有 Integration Intent。MVP 成功入库后 Source 进入 archived，全部关联 Draft 标记 discarded 并保留文件。MVP 入库支持单 Source Draft 和新建 Knowledge，不覆盖／融合已有笔记。Core 完整轮次、调度、独立分析重试和 Zotero Capture 已提供；Agent Planner 可生成跨文件 ChangeSet 并编辑候选，完整批准、正式执行与自动 Vault Git 留待后续阶段。重编译保留旧稿及修改，不要求 Draft 之间的 diff 或独立 rollback 界面；正式笔记可用现有 Git 工具管理。

## 安装

先构建相邻主仓库的 Contracts 与 Core，再在本仓库运行：

```powershell
npm ci
npm run build
```

将 `main.js`、`manifest.json`、`styles.css` 放入目标 Vault 的 `.obsidian/plugins/engramweave/`，在 Obsidian 的第三方插件设置中启用 EngramWeave。构建产物未纳入 Git；本地交付包位于 `.local/release/engramweave/`。

启动配置此 Vault 的 Desktop 或独立 Core，配置好 Compiler 和 Analysis Profiles。插件设置只需选择 Core `config.json` 的绝对路径，点击 **Test connection**。默认路径为 `%LOCALAPPDATA%/EngramWeave/p1/config.json`；使用 `ENGRAMWEAVE_CONFIG` 启动 Desktop 时，改填实际路径。当前 Obsidian Vault 必须与 Core 配置一致。插件不启动／关闭 Core，Core 不依赖插件是否开启。

Core Token 和模型密钥留在 Vault 外的应用数据目录，插件只保存配置路径，不要求复制密钥。API／Codex、模型、模板和 Profile 由 Desktop 配置；模板可在 `90_System/Prompts` 个性化编辑。已有模板不会因程序更新被覆盖。默认示例提醒 Analyzer：Annotation 可以按用户理解融入正文，控制用的 revision hash 差异本身不是知识问题。

Analyzer 默认各给出 0–3 项短建议，每项 1–2 句，建议直接显示，Evidence 与 Coverage & details 折叠。模型只引用短证据 ID，由 Core 补齐版本和片段范围；已有分析仍可查看。输出预算分别在 Desktop 的 Compiler、Review／Relation API 配置中设置；留空用服务默认，Codex 不应用 API token 上限。服务没有开启 structured output 时，明确选择 JSON in text；不会自动替换格式。

## 使用

1. 在 Desktop／Web Clipper 登记材料，或使用已有 Source。打开 `20_Sources` 的 Source，点击左侧脑图标或命令 **EngramWeave: Open Draft review sidebar**。未登记／登记过期的文件可明确点击 **Refresh Workspace**；它登记当前文件，并按既有规则增量更新已建立的语义索引，不是首次建索引。
2. 选择 Analysis Profile；**Source / Default Profile** 使用 Source 已选 Profile 或 Desktop 默认 Profile。**Run Knowledge Compiler** 交给 Core 登记当前材料并完成 Compiler 和 Draft Analyzer，无需预先 Refresh。成功新增 Draft，保留旧稿；客户端关闭也继续轮次，仍在原 Source 时才自动打开新稿。
3. 在 Obsidian 原生编辑 Draft。侧边栏显示 Annotation、两项分析及各自 Job／版本、证据、失败和过期提示。**Analyze Draft** 明确运行两项；**Retry Review／Retry Relation** 只运行选中项，保留另一项真实结果。普通编辑和打开文件不调用模型；Core 仅按明确执行或 Desktop 已启用的计划运行。
4. 在 **Human Review → Review Note** 填写最多 8000 字符，明确选择一个动作。**Create Idea** 原样保存正文到 `10_Ideas`，回链 Source／当前 Draft；**Recompile** 追加 Source Annotation、返回 pending，保留所有 Draft；**Review Complete** 保存此 Draft 自己的 Intent、将 Source 置为 reviewed 并选中当前 Draft。三者都不立即调用模型，确认成功才清空对应输入。
5. **Review Complete** 不要求执行 AI 分析，可对已有 compiled Draft 直接人工确认。展开 **This Draft · Integration Intent** 查看当前稿的 Intent，另行查看 **Reviewed Draft** 当前选择。规划开始前确认另一份 Draft 直接切换选择，保留其他稿及各自 Intent。**Cancel Review Complete** 返回 compiled，不消费输入、不删除 Intent。Reviewed 正文仍可编辑；配置 Agent Planner 后可生成 ChangeSet。
6. 若要使用独立 **MVP · Publish to Knowledge**，Analyzer 尝试结束后检查目标路径与完整 Draft 清理列表，再点击 **Approve & Publish**。插件先保存已打开的 Source／Draft 编辑，再由 Core 核对版本。同名文件需重新选择路径；嵌套目录需已经存在。此入口不消费 Review Note，也不将 Intent 追加到正式正文。
7. MVP 成功后自动打开 Knowledge，保留原 Source 和 Draft 文件，撤销当前规划选择。再次打开已入库 Draft可 **Open Knowledge**。随后 **Refresh workspace** 按已有规则更新登记和已初始化的语义索引。

AI 分析可选，未分析的 Draft 也可 **Review Complete**。模型失败时 Draft 保留，侧边栏显示失败，任务结束后仍可人工确认；运行中的任务仍按 Core 互斥规则等待结束。若只在 Desktop 执行了正文 Compiler，可直接审阅，也可按需点击 **Analyze Draft** 获取建议。分析只是参考，需核验其内容与依据。

## 断线与恢复

关闭侧边栏／插件不取消 Core 完整轮次，也不阻止后续 Analyzer 启动。重新连接后查看 Draft 和任务结果。分析失败可对具体 Draft 单项重试，不必重编译正文。通信失败不自动重发；同一操作的不确定请求保留 ID，明确重试由 Core 返回已有回执，避免重复模型／反馈／审批。

未提交 Review Note 按 Draft 在当前插件会话中保留，刷新、切换文件和关开侧边栏不丢。输入聚焦时延后后台重绘；退出／重载插件不保存未提交文字。已发送但送达不明的动作另留 Vault 外临时恢复记录，重载后上方提供 **Check Result／Retry Original**，沿用原 ID 和 Vault；结果明确后清理，不自动重投。失败保留输入，后来输入不会被旧回执清空。持久 Intent 位于 Core 应用数据目录，备份范围和保护规则见 [Human Review 合同](../engramweave/docs/human-review.md)。

入库异常时保留确认输入和原 `request_id`，可在当前弹窗重试。不关闭弹窗即可重试不确定送达；重开插件时 Core 启动恢复记录，Draft 侧边栏显示完成或未完成结果。已发表内容不会被重复创建或覆盖。Source／Draft 并发变化、目标被删除或替换时，检查错误和保留文件再解决冲突；不能用删除恢复记录当作取消。详细规则见 [Core 合同](../engramweave/docs/obsidian-mvp.md)。

Desktop 的 Restore Source 只恢复该 Source 为 active/pending，不重新激活旧 Draft、正式内容或审阅选择，不立即调用模型；各 Draft 的 Intent 保留，后续按 pending 处理。

备份时将 Vault 与对应 Core 应用数据一并保留。Intent、已接受反馈和撤销记录不在 Vault 内；只恢复 Markdown 或 SQLite 不足以恢复全部工作流。Core 离线恢复完成后需用同一配置正常启动，再在侧栏核对当前选择、各稿 Intent 和原请求查明入口。详细步骤见 [备份与 P2 恢复](../engramweave/docs/recovery.md)。启动插件不会自动重投未知请求或执行模型。

侧栏一次刷新中同一 Analyzer 结果 ID 只读取一次；Review／Relation 使用不同 Job 时分别读取，不跨刷新复用旧结果，也不省略过期检查。

## 验证

`npm test` 验证本机连接、Vault 身份、输入消费、后续编辑保护和有界送达恢复；`npm run build` 检查官方 Obsidian 类型并生成安装文件。

原生检查：完整编译／分析 → 编辑 Draft → 弹窗核对路径与关联稿 → 入库；确认 Knowledge 有 Source 回链、刚编辑的正文与 Properties，Source 为 archived，关联 Draft 为 discarded 且文件仍在。另检查分析失败能审阅、同名目标不覆盖、断开 Core 能显示错误、切换普通 Knowledge 不触发模型。没有自动 Vault Git。

Human Review 检查：分别输入 Idea、反馈、Intent，核对各自去向；确认 A 后再确认 B，检查独立 Intent 与当前选择；取消不清输入，普通编辑不撤销许可。切换文件和关开侧边栏保留输入，重载只恢复已发送动作；用 Check Result／Retry Original 确认没有重复文件或 Annotation。

## ChangeSet 候选编辑

在 Desktop 配置 Integration Planner，在当前所选 Reviewed Draft 点击 **Generate ChangeSet**。侧栏的 **Open ChangeSet** 或命令 **Open ChangeSet candidates** 打开双栏编辑视图；Desktop 的结果链接打开同一视图。

中央只显示内容对比，文件选择、保存／刷新／取消、状态和整合说明在右侧 EngramWeave 栏。左栏 Current 只读，右栏 Candidate 可编辑；新建文件的 Current 为空。**Open original Draft** 在新标签打开该方案关联的原 Draft 当前文件，供用户自行对照；文件不存在时提示，不创建替代文件，不额外提供审查快照或改动比例。**Save Candidate／Ctrl+S** 仅保存候选；**Refresh Current** 保留右栏正文和撤销历史。切换／关闭视图保留未保存缓冲，Vault 外 OS 应用数据临时缓存也可在重开后恢复。保存断线或冲突不会丢弃编辑；**Reload Candidate** 需明确确认丢弃未保存内容。

**Preview Candidate** 先保存候选，再在新标签用 Obsidian 原生阅读视图打开对应 Markdown；保存失败或出现新编辑不会打开过期预览。原 Draft 文件保留。

**Cancel ChangeSet** 清理未批准方案，保留 Draft／Intent，并在有效选择下返回 reviewed；**Cancel Review Complete** 返回 compiled。目前可生成、编辑和取消候选，完整影响审查／拒绝／批准、正式 Executor 与 Git 属于后续 P3 阶段。插件不能通过候选保存修改正式文件。

建议 Vault Git 排除 `/70_ChangeSets/`，Obsidian 的 Files and links → Excluded files 另加 `70_ChangeSets`；使用 Obsidian Sync 时另外设置排除，避免临时方案混入搜索或同步。Core 不自动改动这些用户设置。备份需同时保留未消费候选及 Core Planner/Human Review 回执，见 [Planner 合同](../engramweave/docs/planning.md)。

原生检查还应覆盖中文输入、长文滚动、保存重开、刷新后的撤销、未保存关闭、断线和外部候选冲突；自动 API/mock 测试与原生宿主验证分别记录。
