# EngramWeave for Obsidian

在 Obsidian 原生编辑 Draft，右侧查看 Source Annotation、Review Analyzer 与 Relation Analyzer。核对并修改正文后，明确确认新建 `40_Knowledge` 笔记。Core 负责模型执行、文件版本保护和可恢复归档，插件不改写分析输出到正文。

本 MVP 面向 Windows 本地 Vault。Source 可以有多份 Draft；成功入库后 Source 进入 archived，全部关联 Draft 标记 discarded 并保留文件。只支持单 Source Draft 和新建 Knowledge，不覆盖／融合已有笔记；Planner、ChangeSet、Review Note 三动作、调度、Zotero 和自动 Vault Git 留待完整流程。正式笔记可用现有 Git 工具管理。

## 安装

先构建相邻主仓库的 Contracts 与 Core，再在本仓库运行：

```powershell
npm ci
npm run build
```

将 `main.js`、`manifest.json`、`styles.css` 放入目标 Vault 的 `.obsidian/plugins/engramweave/`，在 Obsidian 的第三方插件设置中启用 EngramWeave。构建产物未纳入 Git；本地交付包位于 `.local/release/engramweave/`。

启动配置此 Vault 的 Desktop 或独立 Core，配置好 Compiler 和 Analysis Profiles。插件设置只需选择 Core `config.json` 的绝对路径，点击 **Test connection**。默认路径为 `%LOCALAPPDATA%/EngramWeave/p1/config.json`；使用 `ENGRAMWEAVE_CONFIG` 启动 Desktop 时，改填实际路径。当前 Obsidian Vault 必须与 Core 配置一致。插件不启动／关闭 Core，Core 不依赖插件是否开启。

Core Token 和模型密钥留在 Vault 外的应用数据目录，插件只保存配置路径，不要求复制密钥。API／Codex、模型、模板和 Profile 由 Desktop 配置；模板可在 `90_System/Prompts` 个性化编辑。已有模板不会因程序更新被覆盖。默认示例提醒 Analyzer：Annotation 可以按用户理解融入正文，控制用的 revision hash 差异本身不是知识问题。

## 使用

1. 在 Desktop／Web Clipper 登记材料，或使用已有 Source。打开 `20_Sources` 的 Source，点击左侧脑图标或命令 **EngramWeave: Open Draft review sidebar**。未登记／登记过期的文件可明确点击 **Refresh Workspace**；它登记当前文件，并按既有规则增量更新已建立的语义索引，不是首次建索引。
2. 选择 Analysis Profile；**Source / Default Profile** 使用 Source 已选 Profile 或 Desktop 默认 Profile。点击 **Run Knowledge Compiler**，顺序运行 Compiler 和 Draft Analyzer，完成后打开新 Draft。每次成功编译新增 Draft，保留旧稿。
3. 直接在 Obsidian 编辑 Draft 正文。侧边栏显示 Annotation、两项分析、可点击的证据路径、失败和过期提示；需要时点击 **Analyze Draft**，只重跑分析。普通编辑、打开文件和启动不会调用模型。
4. Analyzer 尝试结束后，点击 **Publish to Knowledge**，检查目标路径和完整 Draft 清理列表，再点击 **Approve & Publish**。插件先保存已打开的 Source／Draft 编辑，再由 Core 核对审批版本。同名文件需重新选择路径；嵌套目录需已经存在。
5. 成功后自动打开 Knowledge。原 Source 和 Draft 文件保留。再次打开已入库 Draft，侧边栏提供 **Open Knowledge**。随后 **Refresh workspace** 可按已有规则更新登记和已初始化的语义索引。

模型失败不等于人工审阅失败：Draft 保留，侧边栏显示 Analyzer 失败；尝试结束后仍可人工确认。分析只是建议，需核验其内容与依据。若只在 Desktop 执行了正文 Compiler，打开 Draft 后执行 **Analyze Draft** 再审阅。

## 断线与恢复

关闭侧边栏／插件不会取消 Core 已开始的任务。重新打开后查看 Source 的 Draft 或 Draft 的 Analyzer 状态；若 Compiler 完成后客户端已经关闭，继续对已有 Draft 执行分析，不必重编译。通信失败不自动重复模型或审批。

入库异常时保留确认输入和原 `request_id`，可在当前弹窗重试。不关闭弹窗即可重试不确定送达；重开插件时 Core 启动恢复记录，Draft 侧边栏显示完成或未完成结果。已发表内容不会被重复创建或覆盖。Source／Draft 并发变化、目标被删除或替换时，检查错误和保留文件再解决冲突；不能用删除恢复记录当作取消。详细规则见 [Core 合同](../engramweave/docs/obsidian-mvp.md)。

## 验证

`npm test` 验证本机连接、Vault 身份和断线后不自动重复请求；`npm run build` 检查官方 Obsidian 类型并生成安装文件。

原生检查：完整编译／分析 → 编辑 Draft → 弹窗核对路径与关联稿 → 入库；确认 Knowledge 有 Source 回链、刚编辑的正文与 Properties，Source 为 archived，关联 Draft 为 discarded 且文件仍在。另检查分析失败能审阅、同名目标不覆盖、断开 Core 能显示错误、切换普通 Knowledge 不触发模型。没有自动 Vault Git。
