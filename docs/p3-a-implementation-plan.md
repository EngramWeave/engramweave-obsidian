# P3 A：Obsidian 候选编辑视图施工说明

> 范围：[系统 A 计划](../../engramweave-docs/P3_A_IMPLEMENTATION_PLAN.md) A0、A3、A9–A11；[详细 TODO](../../engramweave-docs/P3_A_TODO.md)。以下为待实现方案，现有原生 Draft 审阅与 MVP publication 保持不变。

## 1. 代码与依赖

沿用 `src/main.ts` 的 Plugin／ItemView 注册和现有 `connection.ts` 的认证／Vault 检查，新增独立 ChangeSet view、编辑状态及工作流客户端方法。保持新责任内聚，避免将编辑器、脏缓冲、异步保存和状态处理全部加进现有 main.ts。新测试依然使用 Vitest，遵守 tests/AGENTS.md。

新增 `@codemirror/merge` 是双栏 Diff 编辑的当前必要依赖，使用官方 MergeView，不复制 VS Code、Monaco 或整套第三方插件。使用 Obsidian 宿主提供的 CM 核心模块，按[官方插件构建示例](https://github.com/obsidianmd/obsidian-sample-plugin/blob/master/esbuild.config.mjs)核查 esbuild external，避免重复打包 state/view 等模块形成不兼容实例；merge 自身须进入插件构建。锁定与当前宿主兼容的版本，通过真实 Obsidian 验证，不能只根据 npm 安装成功宣称可用。

双栏组件和只读扩展参考[MergeView 官方示例](https://github.com/codemirror/merge)；该仓库的 README 指向[当前官方源码仓库](https://code.haverbeke.berlin/codemirror/merge)。首版只需 Markdown 源文编辑与 Diff，不承诺 Obsidian Live Preview 的全部宿主扩展，也不操作原生编辑器内部未公开对象。

## 2. A0 的最小可行性切片

注册一个独立 ItemView，展示真实 Markdown；左侧配置 readOnly 与 non-editable，右侧正常编辑。验证中文输入、选区、撤销／重做、键盘保存路由、长文滚动及大小调整。视图销毁释放 MergeView 和事件监听，反复打开不留下重复 handler。

Refresh 通过左侧 transaction 更新 Current，不重建右侧 EditorState；因此 Candidate 文本、选择和 undo 不被清空。先验证保存回调及 dirty 标记，持久化在 A3 接 Core；原始样本和现场记录放 `.local/p3/a/`，不搭建另一套测试应用或提交假的正式候选入口。

## 3. A3 的真实候选读写

以 ChangeSet ID／条目 ID 作为视图状态，客户端从 Core 获取候选、revision 及 Current 内容；用户选择文件时新建目标的 Current 为空。读写只通过 Core，不在插件中直接 fs 写 Vault 或最终正式文件。

编辑状态按 ChangeSet／条目隔离，保存串行且携带读到的候选 revision。保存成功只确认该次提交文本；用户发送后继续输入，响应不能将后来的编辑标为已保存。Ctrl+S 阻止落入原生正式文件保存流程；断网／冲突保留本地脏缓冲、展示错误，不静默重试覆盖。

Refresh Current 先沿现有 flushEditors 保障原生编辑器已保存，再读取最新正式内容，只更新左侧。切换、关闭和卸载须明确处理未保存编辑及进行中的保存；A0 实测原生关闭时序后选最小保护方式，关闭失败／冲突不能静默丢内容。重开恢复已保存文件，未保存处理、关闭及请求不确定的行为必须分别验证，不能以页面关闭替代磁盘保存成功。

第一版 A 只提供打开、最小文件选择、候选保存、刷新和任务结果导航；完整影响清单、条目拒绝／打回、最终批准属于 B，不显示会修改正式笔记的虚假批准按钮。系统要求的取消 Review Complete 用既有 Human Review 入口调用 Core，planned 阶段的可用性和提示随 Core 合同补齐。

## 4. 与现有工作流衔接

从当前已选择的 Reviewed Draft 显式启动 Planner，调用 Core 同一轮次服务，跟踪 Job，成功后打开 ready 候选。主动任务启动前 flush 原生编辑器；切换文件不改变已启动任务输入，结果不会抢夺用户后来导航的页面。

Planner 配置仍在 Desktop，插件不保存模型密钥或 task capability token。沿用 CoreClient 的连接恢复与原 Vault 校验；请求不确定时保留原 request ID，查结果或显式重试，不自动发出新规划。普通编辑、打开视图、刷新展示不调用模型。

`70_ChangeSets` 的 Git 与 Core 检索排除由 Core 合同说明；插件文档单独指出 Obsidian 搜索排除和 Sync 是独立设置，不擅自改用户配置或声称 `.gitignore` 会作用于二者。A 不增加 Desktop 第二套编辑界面。

## 5. 验证方法

测试重点为保存 revision／脏状态、过期响应、切换隔离、断线保留、不同 Vault 拒绝和 workflow request identity。编辑器排版、IME、滚动和关闭行为使用真实宿主短检查；mock 成功不代替原生验证。源码与 helper 放 src/ 与 tests/，现场材料放 `.local/p3/a/`。

```powershell
npm run typecheck
npm run build
npm test
```

原生检查同时查看正式文件和候选文件字节：Ctrl+S 只改 Candidate；Refresh Current 不丢右侧 undo；保存成功后重开相同内容；未保存切换／关闭、保存冲突及 Core 断开不静默丢编辑。当前 MVP publication、Review Note 及独立 Draft Intent 继续回归；文档区分 A 新增候选编辑与仍待 B–D 的批准／应用／Git。
