# AI 情报站

一个运行在本机的 AI 资讯聚合页。把中文/英文官方机构、科技媒体、微信公众号和博主内容汇集在一个可搜索、可筛选的页面里。项目不依赖第三方 npm 包，仅使用 Node.js 内置模块。

## 功能

- 汇总公开 RSS / Atom 资讯源、微信公众号桥接源、B站 UP 主视频和搜狐号同步文章。
- 按 **官方机构 / 官方媒体 / 博主·UP主** 及 **中文 / English** 筛选，可交叉组合。
- 按标题和摘要搜索，提供最近 24 小时、工具/教程/工作流、模型/发布/评测快捷筛选。
- 点击卡片打开原始文章或视频。
- 15 分钟本地缓存；缓存过期时先显示旧内容，再后台更新。

## 信息源

来源在 `server.js` 顶部的 `SOURCES` 数组定义。大致包括：

- **官方机构**：OpenAI、Google AI、Hugging Face、NVIDIA Generative AI、Google DeepMind。
- **官方媒体**：量子位、机器之心、新智元、爱范儿、IT之家、少数派、Hacker News、TechCrunch AI、The Verge AI、极客公园。
- **博主 / UP主**：夕小瑶科技说、APPSO、歸藏的 AI 工具箱、AI进化论·花生、老石谈芯、Simon Willison。

微信公众号通过第三方 [wechat2rss](https://wechat2rss.xlab.app/) 服务同步，不是微信官方 API；B站列表通过公开页面接口读取，可能受平台风控、网络环境和接口变更影响。源抓取失败时，页面会标明失败源，其余内容仍可使用。

## Windows 快速开始

1. 安装 [Node.js](https://nodejs.org/)（建议 LTS，Node.js 18 或更新版本）。
2. 解压/克隆整个项目文件夹；不要只复制 `index.html`。
3. 双击 `launch.vbs`。脚本会尝试从 PATH 和常见安装目录查找 Node.js、启动本地服务并打开主页。

服务启动后也可直接访问：<http://127.0.0.1:8437/>。仅用于检查服务健康状态的接口是 <http://127.0.0.1:8437/api/ping>，会返回 `pong`，不是主页。

### 命令行启动

在项目文件夹运行：

```powershell
node server.js
```

然后浏览器打开 <http://127.0.0.1:8437/>。默认端口被占用时，服务会顺延尝试 8438–8441，并将实际端口写入本地 `port.txt`。

## 添加或移除来源

在 `server.js` 的 `SOURCES` 数组增删一项：

```js
{ key: "example", name: "Example AI", kind: "rss", type: "institution", lang: "en", url: "https://example.com/feed.xml" }
```

字段说明：

- `key`：唯一标识，应与其他来源不同。
- `name`：页面上显示的来源名称。
- `kind`：`rss`、`bilibili` 或 `sohu`。
- `type`：`institution`、`media` 或 `blogger`。
- `lang`：`cn` 或 `en`。
- RSS 源提供 `url`；B站来源提供 UP 主 `mid`；搜狐号来源提供 `authorId`。

修改来源后停止并重新启动 `node server.js`。若需要立即清除旧抓取结果，可先停止服务，再删除本地 `aihub-cache.json`；服务会重新抓取并生成缓存。

## 文件结构

```text
ai-hub/
├── index.html       页面 UI 与筛选逻辑
├── server.js        本地 HTTP 服务、RSS/Atom 解析、抓取与缓存
├── launch.vbs       Windows 双击启动器
├── README.md        项目说明
└── .gitignore       本地运行数据忽略规则
```

## 隐私与网络说明

- 服务仅监听 `127.0.0.1`，不会作为局域网或公网服务器对外开放。
- 读取公开信息源并在本地生成 `aihub-cache.json`；缓存、端口、Node.js 路径等运行状态文件默认不纳入 Git。
- B站抓取会携带其公开接口需要的匿名访客标识 cookie；不使用账号登录凭据。
- 所需网络访问依赖各内容站点与桥接服务的可用性；个别源临时失败不影响其他来源。

## 技术要求

- Windows 10/11（`.vbs` 启动器专用）
- Node.js 18+
- 支持现代网页标准的浏览器

## 许可

项目代码由项目维护者提供。第三方资讯、文章、视频及品牌归各来源所有；本工具只呈现标题/摘要和原文链接，请在原站阅读并遵循各来源的使用条款。
