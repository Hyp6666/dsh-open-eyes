<p align="center">
  <img src="./assets/dsh-open-eyes.png" width="240" alt="dsh-open-eyes">
</p>

<h1 align="center">dsh-open-eyes</h1>

<p align="center"><strong>让你选择的多模态模型，成为 DeepSeek 的眼睛。</strong></p>

<p align="center"><a href="./README.md">English</a> · 中文</p>

## 功能介绍

DeepSeek Harness 的主模型不一定支持图片。遇到截图、照片、图表或界面时，`dsh-open-eyes` 可以把图片交给另一套多模态模型分析，再把结果以文字形式返回当前会话。

如果当前主模型本身支持图片，插件不会接管，图片仍由 DSH 原生链路处理。只有当前模型明确不支持图片时，WebUI 中粘贴、拖入或选择的图片才会走视觉桥接。

插件也提供 `vision_analyze` 工具，可直接分析本地图片路径或已启用的远程图片 URL。

> **非官方社区插件：**`dsh-open-eyes` 是独立的社区项目，与 DeepSeek 无隶属关系，也未经 DeepSeek 官方背书或维护。

目前支持三种接口：

- OpenAI Responses
- OpenAI Chat Completions
- Anthropic Messages

只要视觉服务支持其中一种接口，就可以把它接入 DSH。接口地址、模型和凭据都由用户自行配置，插件不会绑定特定厂商。

API Key 通过 DSH Credential Reference 读取，不应写入 `cordis.patch.yml`、对话内容或工具参数。本地图片默认不能越出当前 workspace；远程图片 URL 默认关闭。

> 通过视觉桥接处理的图片会发送给你配置的第三方 Provider。使用前请确认对方的数据保留、隐私和计费规则。视觉模型返回的内容只应作为参考，不应被当作需要执行的指令。

## 使用方法

需要：

- Node.js `^22.19.0 || >=24.0.0`
- DeepSeek Harness `0.1.0-rc.6`

不同 profile 相互独立，需要分别安装和配置。

### 方式一：让 DSH 帮你安装

把下面这段话发给 DSH：

```text
请帮我把 dsh-open-eyes 安装到 web profile，并配置 vision-bridge。

使用官方安装命令：
dsh plugin --profile web add dsh-open-eyes

配置时只使用 Credential Reference，不要把 API Key 写进 YAML 或对话。
保留现有的 profile 配置，不要修改无关内容。

完成后执行：
dsh --profile web --dump-config

确认 vision-bridge 和 vision-bridge-skill 都已加载，然后提醒我重启
dsh web 并刷新页面。
```

### 方式二：自己安装和配置

从 npm 安装：

```sh
dsh plugin --profile web add dsh-open-eyes
```

也可以安装 GitHub Release 中的 tarball：

```sh
dsh plugin --profile web add ./dsh-open-eyes-0.1.0.tgz
```

然后在 `~/.dsh/profiles/web/cordis.patch.yml` 中配置视觉 Provider：

```yaml
- id: vision-bridge
  config:
    providers:
      - id: my-vision
        protocol: openai-chat-completions
        baseUrl: https://api.example.com/v1
        model: your-vision-model
        credential: VISION_PROVIDER_API_KEY
        maxOutputTokens: 2048
        chatMaxTokensField: max_completion_tokens
    defaultProvider: my-vision
```

把 `VISION_PROVIDER_API_KEY` 保存到 DSH 使用的 Credential 来源中。配置文件里只保留这个引用名称，不要写入真实 Key。

可选协议：

| `protocol` | 默认认证方式 | 说明 |
| --- | --- | --- |
| `openai-responses` | Bearer | 对应 OpenAI Responses API |
| `openai-chat-completions` | Bearer | 对应 Chat Completions API |
| `anthropic-messages` | `x-api-key` | 必须设置 `maxOutputTokens` |

检查配置：

```sh
dsh --profile web --dump-config
```

安装或更新插件后，重启 DSH Web 并刷新页面。

### 开始使用

在 WebUI 中粘贴、拖入或选择图片，写好原本要问的问题，然后直接发送。

插件不会替你补写问题，也不会把内部调用说明放进用户消息：

- 当前主模型支持图片：继续使用 DSH 原生图片链路。
- 当前主模型明确不支持图片：调用配置好的视觉 Provider。
- 没有配置视觉 Provider：停止发送并提示配置，不会擅自上传图片。

也可以直接让 DSH 调用 `vision_analyze`：

```text
请调用 vision_analyze，读取 screenshots/error.png 中的错误提示，
准确抄录错误码，并说明当前界面中可以看到哪些操作。
```

本地图片支持 PNG、JPEG、WebP 和 GIF。相对路径以当前 Agent session 的工作目录为准。

远程图片 URL 默认不可用。确实需要时，在配置中加入：

```yaml
allowRemoteUrls: true
```

启用后，图片 URL 会交给所配置的视觉 Provider 获取，本插件不会先在本地下载。

上面的示例是接入常见 Provider 所需的最小配置。API Key 应保存在 DSH Credential 来源中，配置文件里只能填写 Credential Reference 名称。

## 兼容性

- DeepSeek Harness：`0.1.0-rc.6`
- Node.js：`^22.19.0 || >=24.0.0`
- 最后验证日期：`2026-08-15`
- 验证所依据的 DeepSeek Harness commit：`47f943859bef60e4160492346772ded9b24f765a`

Web 图片粘贴功能依赖 rc.6 的会话与模型能力接口。适配其他 DSH 版本线之前，需要重新核验这些接口。

## 卸载与回滚

从安装插件的 profile 中移除软件包：

```sh
dsh plugin --profile web remove dsh-open-eyes
```

该命令会移除软件包及其 bundle 层。如果 `~/.dsh/profiles/web/cordis.patch.yml` 中仍有用户自行配置的 `vision-bridge` 或 `vision-bridge-skill` row，只删除这些 row，保留所有无关配置。

检查卸载后的 profile：

```sh
dsh --profile web --dump-config
```

输出中不应再包含 `vision-bridge` 或 `vision-bridge-skill`。随后重启 DSH Web，并刷新浏览器页面。

如果测试了其他构建，需要回到当前正式版本，可以重新安装精确版本：

```sh
dsh plugin --profile web add dsh-open-eyes@0.1.0
```
