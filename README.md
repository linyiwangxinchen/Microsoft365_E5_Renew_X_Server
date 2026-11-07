# Microsoft365_E5_Renew_X_Server

> ## Microsoft 365 E5 Renew X API Web Service.
> ### [SundayRX](https://blog.csdn.net/qq_33212020 "SundayRX") 开发 : [E5 调用API续订程序：Microsoft 365 E5 Renew](https://blog.csdn.net/qq_33212020/article/details/106837905 "E5 调用API续订程序：Microsoft 365 E5 Renew")
> ### [DavidDengHui](https://covear.top/ "啊晖de老窝") 整理 : [Microsoft 365 E5 白嫖教程（二）](https://covear.top/blogs/275 "Microsoft 365 E5 白嫖教程（二）")
> ### 试用 : [Microsoft 365 E5 Renew X 主页](https://e5.covear.top "Microsoft 365 E5 Renew X 主页")

## Node Web 版本（Linux Web Server / Docker）

本仓库新增 `node-renewx/`，是可在 Linux Web Server 上运行的 Node.js Web 控制台，支持 Microsoft OAuth、刷新令牌、ROPC、Client Credentials、Graph 调度、Renew Plus `Config.cfg` 导入、运行日志和临时失败退避。账号密码、Client Secret、Refresh Token 只以加密形式存储；请勿把真实 `.env` 或 `Config.cfg` 提交到 GitHub。

### Linux 原生部署

要求 Node.js 20.11 或更新版本：

```bash
cd node-renewx
cp .env.example .env
nano .env
# 至少设置 ADMIN_PASSWORD、DATA_ENCRYPTION_KEY 和 PUBLIC_BASE_URL
set -a
. ./.env
set +a
npm ci
npm run build
npm start
```

默认访问 `http://服务器地址:3000`。修改 `.env` 中的 `PORT` 可以更换 Node 服务端口，例如 `PORT=8080`；反向代理和 OAuth 回调地址也要同步使用新端口或域名。

### Docker 部署

#### 一键安装

在一台已经安装 Docker 的 Linux 服务器上，可以直接执行：

```bash
curl -fsSL https://gh-proxy.org/https://raw.githubusercontent.com/linyiwangxinchen/Microsoft365_E5_Renew_X_Server/master/install-docker.sh | sudo bash
```

脚本会把项目放到 `/opt/microsoft365-e5-renewx`，交互式创建 Web 管理员密码和数据加密密钥，生成 `.env`，构建容器并等待健康检查。Docker 未安装时可显式允许脚本使用 Docker 官方安装器：

```bash
curl -fsSL https://gh-proxy.org/https://raw.githubusercontent.com/linyiwangxinchen/Microsoft365_E5_Renew_X_Server/master/install-docker.sh | sudo bash -s -- --install-docker
```

修改对外端口时，在运行脚本前传入 `WEB_PORT`，例如使用 8080：

```bash
curl -fsSL https://gh-proxy.org/https://raw.githubusercontent.com/linyiwangxinchen/Microsoft365_E5_Renew_X_Server/master/install-docker.sh | sudo env WEB_PORT=8080 bash
```

也可以先下载脚本再查看后执行：

```bash
curl -fL https://gh-proxy.org/https://raw.githubusercontent.com/linyiwangxinchen/Microsoft365_E5_Renew_X_Server/master/install-docker.sh -o install-docker.sh
chmod +x install-docker.sh
sudo ./install-docker.sh --web-port 8080
```

脚本默认使用 `https://gh-proxy.org` 加速 GitHub 的脚本、源码归档和 Git clone；如该代理不可用，可改用另一个兼容前缀，例如 `GH_PROXY_BASE=https://ghproxy.net`，或执行 `--no-proxy` 直连 GitHub。脚本会保留已有 `.env` 和 `node-renewx/data`，不会读取、复制或上传本地 `Config.cfg`。更新时重复执行即可；已有源码存在未提交修改时，脚本会停止以避免覆盖。

#### 更新已部署版本

重复执行同一个一键命令即可更新源码、重新构建并重启容器：

```bash
curl -fsSL https://gh-proxy.org/https://raw.githubusercontent.com/linyiwangxinchen/Microsoft365_E5_Renew_X_Server/master/install-docker.sh | sudo bash
```

也可以使用专用更新脚本。它会保留现有的 `node-renewx/.env` 和 `node-renewx/data`，拉取最新源码后重新构建并等待健康检查：

```bash
curl -fsSL https://gh-proxy.org/https://raw.githubusercontent.com/linyiwangxinchen/Microsoft365_E5_Renew_X_Server/master/update-docker.sh | sudo bash
```

如果服务器无法访问代理，可直连 GitHub：

```bash
curl -fsSL https://raw.githubusercontent.com/linyiwangxinchen/Microsoft365_E5_Renew_X_Server/master/update-docker.sh | sudo bash -s -- --no-proxy
```

如果之前使用了其他安装目录，指定原目录：

```bash
curl -fsSL https://gh-proxy.org/https://raw.githubusercontent.com/linyiwangxinchen/Microsoft365_E5_Renew_X_Server/master/install-docker.sh | sudo bash -s -- --dir /opt/microsoft365-e5-renewx
```

脚本会保留 `.env` 和 `node-renewx/data`；有 Git 元数据时使用快进更新，没有 Git 元数据时下载最新源码归档覆盖代码文件。只想重新构建当前代码时，可以执行：

```bash
cd /opt/microsoft365-e5-renewx/node-renewx
sudo docker compose --env-file .env up -d --build
```

```bash
cd node-renewx
cp .env.example .env
nano .env
docker compose up -d --build
```

Docker 对外端口由 `WEB_PORT` 控制，容器内监听端口由 `PORT` 控制。例如：

```dotenv
PORT=3000
WEB_PORT=8080
PUBLIC_BASE_URL=https://e5.example.com
```

此时通过 `http://服务器地址:8080` 访问；生产环境建议在 HTTPS 反向代理后运行。数据目录映射到 `node-renewx/data`，请定期备份。

完整功能、环境变量、OAuth 回调、Renew Plus 配置导入和 API 说明见 [`node-renewx/README.md`](node-renewx/README.md)。

------------


> 想要自动续期 Microsoft 365 E5 开发者订阅计划看过来！

#### 本文主要介绍如何免费续期 Microsoft 365 E5 开发者订阅（下面简称E5）！

*本文所用到的Office都是国际版，非国内运营世纪互联版本！
本文主要是备份汇总一下各类续期方法，
申请开发者订阅教程参见上一篇：
[`Microsoft 365 E5 白嫖教程（一）`](https://covear.top/blogs/248 "Microsoft 365 E5 白嫖教程（一）")*

------------

# 一、E5订阅续期大法汇总

- ## 桌面应用程序
	- ### E5 Renew Plus
		- 教程： [E5 调用API续订程序：Microsoft 365 E5 Renew Plus](https://blog.csdn.net/qq_33212020/article/details/114482595 "E5 调用API续订程序：Microsoft 365 E5 Renew Plus")
		- [E5 Renew Plus 官方网站](https://e5renew.com/ "E5 Renew Plus 官方网站")
		- 下载： [蓝奏云](https://sundayrx.lanzouq.com/2R2AByh83333 "蓝奏云") 、 [OneDrive](https://sundayrx-my.sharepoint.com/%3Au%3A/g/personal/api1_sundayrx_onmicrosoft_com/EbjsV4mOxBlBoE39mBxFpqsBk51BF4y_T4Cs0OB4hV7OsQ?e=HGIlhE "OneDrive") 、 [本站](https://covear.top/download/Microsoft365_E5_Renew_Plus_with_runtime.rar "本站")
- ## 网页应用程序
	- ### E5 Renew X
		- 试用：[E5 Renew X 主页](https://e5.covear.top/ "E5 Renew X 主页")
		- 使用教程： [E5 调用API续订服务：Microsoft 365 E5 Renew X](https://blog.csdn.net/qq_33212020/article/details/119747634 "E5 调用API续订服务：Microsoft 365 E5 Renew X")
		- 源码： [蓝奏云](https://sundayrx.lanzoui.com/aW09Lsss75g "蓝奏云") 、 [本站](https://covear.top/download/Microsoft365_E5_Renew_X.zip "本站") 、 [GitHub](https://github.com/DavidDengHui/Microsoft365_E5_Renew_X_Server "GitHub") 、 [码云](https://gitee.com/DavidDengHui/Microsoft365_E5_Renew_X_Server "Gitee")
		- 部署教程： 
			- .NET 版本
				[在 Windows、Linux 和 macOS 上安装 .NET](https://docs.microsoft.com/zh-cn/dotnet/core/install/ "在 Windows、Linux 和 macOS 上安装 .NET")
				[MS365 E5 Renew 系列帮助文档](https://docs-1.leeskyler.top/#/ "MS365 E5 Renew 系列帮助文档")
				[Microsoft 365 E5 Renew X 部署记录](https://www.gladtbam.top/posts/37680/ "Microsoft 365 E5 Renew X 部署记录")
			- Docker 版本
				[Docker环境搭建](https://www.jianshu.com/p/996e08b7976d "Docker环境搭建")
				[史上最全Docker环境安装指南](https://zhuanlan.zhihu.com/p/82269806 "史上最全Docker环境安装指南")
				[Microsoft 365 E5 Renew X Docker 部署](https://www.gladtbam.top/posts/22256/ "Microsoft 365 E5 Renew X Docker 部署")
				[Docker版 E5续订的E5调用API续订服务：Microsoft 365 E5 Renew X](https://blog.csdn.net/qq_40605167/article/details/122888580 "Docker版 E5续订的E5调用API续订服务：Microsoft 365 E5 Renew X")

	- ### Outlook API 
		- #### E5SubBot
			- 源码： [GitHub](https://github.com/iyear/E5SubBot "GitHub") 、 [Gitee](https://gitee.com/DavidDengHui/E5SubBot "Gitee")
			- 教程： 
				[E5SubBot部署使用说明](https://gitee.com/DavidDengHui/E5SubBot/blob/master/README_zhCN.md "README_zhCN.md")
				[Office365 E5 自动续订机器人](https://www.daniao.org/8879.html "E5SubBot – Office365 E5 自动续订机器人(附宝塔面板简单搭建教程)")
				[Linux下搭建E5SubBot为365 E5续期](https://cloud.tencent.com/developer/article/1760336 "Linux下搭建E5SubBot为365 E5续期(含数据库安装过程)")
		- #### E5续订
			- 试用：[E5续订](https://e5.qyi.io/ "E5续订")
			- 源码：
				前端：[GitHub](https://github.com/luoye663/e5-html "GitHub")
				后端：[GitHub](https://github.com/luoye663/e5 "GitHub")
			- 教程：
				[E5 自动订阅程序[已开源]](https://qyi.io/archives/687.html "E5 自动订阅程序[已开源]")
				[office 365 E5账号自动续订](https://zhuanlan.zhihu.com/p/423382796 "office 365 E5账号自动续订")
		- [Yeek Outlokk API](https://moreant.github.io/yeek-outlook-api "Yeek Outlokk API")
		- [Office E5 开发者订阅注册后的自动续期多种续签方式](https://www.ensu.cc/archives/928/ "Office E5 开发者订阅注册后的自动续期多种续签方式")


------------



# 二、E5订阅续期效果

佛系续期，效果还是很不错的，已经用了一年了 

![file](https://covear.top/wp-content/uploads/2022/04/image-1649601638612.png)

一些可能用得到的Office相关设置链接可从此进入：[Links](https://covear.top/links "Links - 啊晖de老窝")

每次续期成功，都会在个人账户的邮箱中收到这个提示：

![file](https://covear.top/wp-content/uploads/2022/04/image-1649602127445.png)



