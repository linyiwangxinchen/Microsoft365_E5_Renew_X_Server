# RenewX Node Web

这是一个可在 Linux Web Server 上运行的 Node/TypeScript 版本，提供网页账号管理、Microsoft OAuth 授权码、刷新令牌、客户端凭据、Graph 请求调度、运行日志和 Docker 部署。

它复现了原 Microsoft365 E5 Renew X 发布包中的核心调度模型：根据账号认证模式选择 Graph API，按随机顺序抽取请求，保存每次请求结果，并在 429/5xx 时依据 `Retry-After` 或退避策略重试。默认只执行读取请求；写入类测试请求必须同时打开环境变量 `ALLOW_WRITE_ACTIVITY=true`、账号开关和单次运行开关。

当一次运行全部失败，或 10 个以上请求的失败率超过 70% 时，账号会进入临时退避，15 分钟后自动重试；连续失败会指数增加等待时间，最长 6 小时。账号不会被永久暂停，管理员仍可以在网页手动暂停或恢复。配置 SMTP 后会收到不含令牌和密码的失败摘要。

## 导入 Microsoft365 E5 Renew Plus 配置

网页登录后，在“导入 Renew Plus 配置”中选择桌面版的 `Config.cfg` 即可导入。导入器兼容 Renew Plus 的 AES-256-ECB/PKCS#7 加密文件，也接受明文 JSON 作为迁移测试输入；旧字段拼写 `PwdOrSecert` 也会自动兼容。账号会按 `IsLogin` 映射为 ROPC（用户名/密码）或 Client credentials，非登录账号的租户从目标用户 UPN 的域名推导，原来的调度间隔、工作时间、工作日、API 选择和排序选项会保存到 SQLite。

浏览器只向当前 Node 服务上传用户主动选择的文件。导入接口只返回账号数量和调度摘要，不返回密码、客户端密钥或配置正文；重复的“模式 + 用户名 + Client ID”账号会跳过。导入后的高失败率处理使用本项目的临时退避策略，账号保持可恢复状态，不会自动永久暂停。

账号卡片会显示该账号的运行次数、成功/失败次数、请求数和失败率。点击“刷新订阅”后，服务使用该账号的 Graph 令牌读取 `/v1.0/directory/subscriptions`，从匹配的 E5 订阅的 `nextLifecycleDateTime` 显示剩余时间、SKU 和状态。此接口需要 `LicenseAssignment.Read.All` 或更高目录读取权限；权限不足时网页显示读取失败原因，不会回退到手工猜测。Microsoft Developer Program 仪表盘的会员订阅日期可能与租户许可证生命周期提示不同，建议同时核对仪表盘。底部运行历史面板已移除，运行记录仍保存在 SQLite 中供后台统计和 API 查询。

## 编译和启动

要求 Node.js 20.11 或更新版本：

```bash
npm ci
npm run build
cp .env.example .env
# 编辑 .env，至少设置 ADMIN_PASSWORD 和 DATA_ENCRYPTION_KEY
npm start
```

浏览器打开 `http://127.0.0.1:3000`。SQLite 数据库和加密后的凭据保存在 `DATA_DIR/renewx.sqlite`。

## Docker

```bash
cp .env.example .env
# 修改 .env 中的密码和密钥
docker compose up -d --build
```

从 GitHub 一键安装 Docker 版本：

```bash
curl -fsSL https://gh-proxy.org/https://raw.githubusercontent.com/linyiwangxinchen/Microsoft365_E5_Renew_X_Server/master/install-docker.sh | sudo bash
```

更新已经部署的 Docker 版本：

```bash
curl -fsSL https://gh-proxy.org/https://raw.githubusercontent.com/linyiwangxinchen/Microsoft365_E5_Renew_X_Server/master/update-docker.sh | sudo bash
```

更新脚本只替换代码并重新构建镜像，会保留现有 `.env` 和 `data`。需要更换端口或安装目录时，可传入 `--web-port`、`--dir` 等参数；代理不可用时加 `--no-proxy`。

生产环境建议把站点放在 HTTPS 反向代理后，并设置 `PUBLIC_BASE_URL` 为用户实际访问地址。若使用 OAuth 授权码流程，把以下回调地址登记到 Entra 应用：

```text
https://你的域名/api/oauth/callback
```

同时设置 `MICROSOFT_OAUTH_CLIENT_ID`、`MICROSOFT_OAUTH_CLIENT_SECRET` 和 `MICROSOFT_OAUTH_TENANT`。OAuth 仅用于获取用户同意后的令牌，服务端不会记录用户密码。

## 账号模式

### Delegated / refresh token

填写应用 Client ID 和 refresh token，服务使用 refresh-token grant 获取访问令牌。也可以先创建一个账号，再点击“浏览器 OAuth 授权”完成授权码流程。

### Username/password (ROPC)

这是旧版 X 使用的 MSAL ROPC 兼容入口。填写用户名、密码和应用 Client ID 后，服务端直接向 Microsoft 令牌端点换取 Graph 令牌；密码只以加密形式写入 SQLite，不会写入运行日志。ROPC 不支持个人 Microsoft 账号，并可能被 MFA、条件访问或租户策略阻止；优先使用 OAuth 授权码或刷新令牌。

### Client credentials

填写租户、目标用户 UPN、应用 Client ID 和 Client Secret。目标用户用于把旧版 `/me/...` 请求转换为 `/users/{UPN}/...`，租户不能使用 `common`。应用必须已经获得所需的 Microsoft Graph application permissions，并完成管理员同意。该模式只选择目录中标记为可用的 app-only 请求。

### 读取 E5 实际订阅生命周期

账号卡片的“刷新订阅”调用 Microsoft Graph `GET /v1.0/directory/subscriptions`，匹配 E5 SKU 并显示 `nextLifecycleDateTime`。应用需要 `LicenseAssignment.Read.All`，或使用 `Organization.Read.All` / `Directory.Read.All` 等更高权限，并完成管理员同意；Delegated 账号还需要具备受支持的 Entra 目录读取角色。Microsoft Developer Program 仪表盘显示的是开发者计划会员侧日期，可能与租户许可证生命周期不同，Graph 无法保证两者完全一致。

## API

除 `/api/health` 外都需要管理员会话：

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| POST | `/api/auth/login` | 管理员登录 |
| GET | `/api/accounts` | 查看账号、每账号统计和订阅状态（不会返回密钥） |
| POST | `/api/accounts` | 创建账号 |
| POST | `/api/import/legacy-config` | 导入 Renew Plus `Config.cfg`（请求体为 `text/plain`，需要管理员会话） |
| GET/PATCH | `/api/settings/renew-plus` | 查看或修改 Web 端的 Renew Plus 调度选项 |
| PATCH | `/api/accounts/:id` | 修改、暂停或恢复账号 |
| POST | `/api/accounts/:id/subscription-status` | 从 Microsoft Graph 刷新该账号的租户订阅生命周期 |
| POST | `/api/accounts/:id/run` | 立即创建运行任务 |
| GET | `/api/runs` | 查看运行历史 |
| GET | `/api/runs/:id` | 查看请求明细 |
| GET | `/api/oauth/start?accountId=...` | 启动 Microsoft OAuth |

## 运行边界

Microsoft 365 Developer Program 会根据资格和开发活动评估订阅是否续期，Graph API 调用本身不保证续期。开发者租户用于开发和测试，不应当作为生产数据的唯一存储位置；请在外部保留备份。请只把本项目用于你有权管理的租户和应用，并遵守 Microsoft 的条款和权限要求。
