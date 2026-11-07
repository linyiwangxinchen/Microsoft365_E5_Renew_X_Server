# 旧版逻辑与 Node 版映射

## 旧版发布包

原仓库的 `master` 只包含 .NET Core 3.1 发布文件，没有 `.cs`、`.csproj` 或测试源码。核心程序集经过混淆；反编译后可以确认以下流程：

1. `StaticValue.DefaultAPI()` 注册 Graph beta API，保存权限、HTTP 方法、URL、是否允许 app-only 调用和上传内容；Renew Plus 版本还扩展了 Booking、OneNote 和 Drive recent 等入口。
2. `Kernel.UseKernel()` 初始化 CSV 数据库，按 `NoLoginAvailable` 把 API 分成登录和非登录两组，并启动后台线程。
3. 每个账号到达 `NextDate` 后随机抽取一组 API。登录账号使用 MSAL ROPC；非登录账号使用 client credentials。
4. Graph 请求使用 `Authorization: Bearer`，429 时重试，结果写入 `EXAccountRun`；下一次运行延迟约 1000–2000 秒。
5. 连续失败会触发 SmartPause 统计；本 Node 版把这个动作改成临时指数退避，账号保持可恢复状态，并可发送不含凭据的通知邮件。

## Node 版

- `src/catalog.ts` 保留旧目录结构并补充 Renew Plus 的 Booking、OneNote 和 Drive recent 入口；默认只执行读取请求。
- `src/graph.ts` 用 OAuth 2.0 原始 HTTP 实现刷新令牌、客户端凭据和授权码交换；Graph 调用尊重 `Retry-After`，没有该头时使用退避。
- `src/scheduler.ts` 提供后台调度、随机抽取、每账号互斥、运行统计、日志写入和失败后的临时退避。
- `src/db.ts` 用 SQLite 替代 CSV，并使用 AES-256-GCM 加密 Client Secret 和 Refresh Token。
- `src/db.ts` 为每个账号保存可选的界面到期时间，并从运行表聚合运行、请求、成功、失败和失败率统计。
- `src/legacy-config.ts` 兼容桌面版 `Config.cfg` 的 AES-256-ECB/PKCS#7 包装、字段拼写和调度选项；解析只在管理员主动上传时发生。
- `src/server.ts` 提供管理员会话、账号 CRUD、Renew Plus 配置导入与调度设置、OAuth 回调、手动运行和历史查询。
- `public/` 是零构建步骤的控制台，适合直接放在同一个 Node 服务后面；账号卡片显示统计和到期倒计时，设置页覆盖自动运行、随机策略、间隔和工作日，底部运行历史面板不再显示。

Node 版网页优先使用 OAuth 授权码或已获取的刷新令牌，同时保留了一个显式的 ROPC 模式以兼容旧版行为。ROPC 密码只以 AES-GCM 密文存储，必须由用户自行确认 Entra 应用和租户策略允许该流程。
