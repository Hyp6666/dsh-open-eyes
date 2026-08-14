# dsh-vision-bridge

面向纯文本 DeepSeek Harness 主路由的轻量视觉委派工具，原生实现 OpenAI Responses、Chat Completions 与 Anthropic Messages 三套独立 Adapter。

> **数据传输披露：** 每张交给 `vision_analyze` 的图片都会发送给所配置的第三方视觉 Provider。若参数是远程 URL，Provider 会自行抓取该 URL。使用前请核对第三方的数据保留、隐私和计费条款。

> **包身份说明：** GitHub 仓库仍是 `Hyp6666/dsh-vision-bridge`，项目名仍是 `dsh-vision-bridge`；可公开发布的 npm 包名是 `@hope666/dsh-vision-bridge`。该 npm scope 已通过项目所有者现有公开包交叉核验。无 scope 的 npm 同名包属于另一位发布者，并不是本插件。

## 为什么需要它

当主 LLM 路由声明支持图片输入时，Harness 原生图片链路是正确选择：它验证图片并把附件交给同一个主路由。纯文本主路由无法消费该图片附件；仅靠官方 `read_image` 也不能让文本模型突然获得图片输入能力。本插件可以改为调用一套单独配置的多模态 HTTP API，再把视觉分析作为文本证据返回给主模型。

内置 Web 客户端会在不故意提交一次“不受支持图片”的前提下判断能力。每次粘贴图片发送前，它先通过 DSH connection API 读取当前 session 的实际模型，再由服务端查询该模型声明的输入模态。明确声明为纯文本时直接进入桥接委派；声明支持图片或未声明/无法确定时保留 DSH 原生图片链路。每次发送都会重新判断、绝不缓存，因此首轮图片、后续轮次图片、同一会话重复发图和切换模型都使用同一套规则。

与 ModLens 或大型视觉工具箱相比，本项目的边界更窄：只有一个视觉委派 Tool、三份明确的 wire Adapter、一个 Web 粘贴桥和严格的输入限制；它不是 OCR 流水线、Computer Use、模型路由器、Web 设置页或图片生成器。不同工具可以互补使用。

这是独立实现的非官方社区项目，不代表 DeepSeek 背书，也不使用 `@deepseek-ai` 包命名空间。

## 环境与安装

- Node.js `^22.19.0 || >=24.0.0`
- DeepSeek Harness `0.1.0-rc.6`

发布后安装到 Web profile：

```sh
dsh plugin --profile web add @hope666/dsh-vision-bridge
```

首次 npm 发布前，使用 `npm pack` 生成并审阅过的真实 tarball：

```sh
dsh plugin --profile web add ./hope666-dsh-vision-bridge-0.1.0.tgz
```

官方也支持从本地源码目录安装（`dsh plugin --profile web add ./dsh-vision-bridge`），但发布候选优先使用 tarball，这样验证的是预构建产物。

安装到 Headless profile：

```sh
dsh plugin --profile headless add @hope666/dsh-vision-bridge
```

两个 profile 完全独立：在 `web` 中安装或配置不会修改 `headless`，反之亦然。可以检查有效配置：

```sh
dsh --profile web --dump-config
dsh --profile headless --dump-config
```

Harness 会在所选 DSH home 下保存 profile 配置（通常是 `~/.dsh`；测试时可用 `DSH_HOME` 隔离）。用户覆盖文件位于 `$DSH_HOME/profiles/<profile>/cordis.patch.yml`。应通过 DSH 的插件命令管理，而不是修改已安装包。Bundle 会加入稳定行 `vision-bridge` 与 `vision-bridge-skill`，默认不含 Provider 或 Credential Reference。

给已经运行的 Web profile 安装或升级后，必须重启该 DSH 进程并刷新浏览器。当前 DSH 会在进程生命周期内缓存某个包是否具有 `dsh.client` 浏览器半包；仅修改配置仍然可以热重载。

## Credential Reference

Provider 的 `credential` 必须写引用名，例如 `VISION_OPENAI_API_KEY`，绝不能写 API Key。请在相同 profile/运行环境中通过 Harness Credential 机制提供它，例如给 Harness 进程设置环境变量：

```sh
export VISION_OPENAI_API_KEY='your-provider-key'
```

不要把 Key 写进 Provider Config、Tool Arguments、自定义 Header、prompt、截图或仓库。插件只在每次 Tool 调用开始后为选中的 Provider 解析一次，不跨调用缓存。

## 三种协议的完整配置

以下内容表示 profile 的 `cordis.patch.yml` 对 `vision-bridge` 行做 id 定向覆盖。同时保留 `vision-bridge-skill` 行。覆盖会替换整份 `config`，因此所有需要保留的非默认字段都要重写。

### OpenAI Responses

```yaml
- id: vision-bridge
  config:
    providers:
      - id: openai-responses
        protocol: openai-responses
        baseUrl: https://api.openai.com/v1
        model: gpt-4.1-mini
        credential: VISION_OPENAI_API_KEY
        maxOutputTokens: 2048
    defaultProvider: openai-responses
    allowRemoteUrls: false
```

### OpenAI Chat Completions

```yaml
- id: vision-bridge
  config:
    providers:
      - id: openai-chat
        protocol: openai-chat-completions
        baseUrl: https://api.openai.com/v1
        model: gpt-4.1-mini
        credential: VISION_OPENAI_API_KEY
        maxOutputTokens: 2048
        chatMaxTokensField: max_completion_tokens
        extraBody:
          temperature: 0
    defaultProvider: openai-chat
```

如果兼容网关只接受旧字段，使用 `chatMaxTokensField: max_tokens`。

### Anthropic Messages

```yaml
- id: vision-bridge
  config:
    providers:
      - id: anthropic
        protocol: anthropic-messages
        baseUrl: https://api.anthropic.com
        model: claude-sonnet-4-5
        credential: VISION_ANTHROPIC_API_KEY
        maxOutputTokens: 2048
        anthropicVersion: '2023-06-01'
    defaultProvider: anthropic
```

Anthropic 必须配置 `maxOutputTokens`；OpenAI 两个 Adapter 未配置时不发送输出 token 上限。若使用本地无鉴权网关，可配置 loopback `http://localhost:...`、`authMode: none`，并省略 `credential`。

所有限制、鉴权、URL 与保留字段规则见 [configuration.md](docs/configuration.md)。

## 使用 `vision_analyze`

参数：

| 名称 | 必填 | 含义 |
| --- | --- | --- |
| `images` | 是 | 1 到 `maxImages` 个本地路径、已启用的 HTTP(S) URL，或插件生成的 Web 附件引用。 |
| `prompt` | 是 | 明确的视觉问题，长度不超过 `maxPromptChars`。 |
| `provider` | 否 | 已配置的 Provider id；默认使用唯一或默认 Provider。 |
| `detail` | 否 | `auto`、`low` 或 `high`，默认 `auto`。 |

模型调用示例：

```json
{
  "images": ["screenshots/login-error.png"],
  "prompt": "逐字转录对话框标题和错误码，并指出当前可见的选中操作；看不清的字符要标记出来。",
  "detail": "high"
}
```

### 在 WebUI 直接粘贴

在普通 DSH 输入框中粘贴、拖入或选择图片，然后直接发送：

1. 浏览器先读取当前 session 的 Provider 与 Model，不提交 prompt。
2. 同源的只读路由通过 DSH LLM 服务解析该模型声明的输入模态。
3. 声明支持图片或模态未知时，由 DSH 原生处理原始草稿，不调用 `vision_analyze`。
4. 明确声明为纯文本时，桥接端点验证全部图片，通过 `ctx.attachments.saveImage` 保存一次，再返回绑定 session 的不透明引用。
5. 持久 user turn 只包含用户自己的问题和简洁 Markdown 附件链接，例如 `[Attached image 1](vision-bridge://...)`。工具路由、就绪状态、Provider 和调用次数说明只存在于 Tool/Skill 上下文，绝不写进用户可见消息。

若当前路由是纯文本且没有配置 Provider，发送会在上传图片和提交 prompt 之前停止；草稿保留在输入框中，浏览器给出可操作的配置错误，不创建任何合成对话轮次，也不会保存图片或发送给第三方。Tool description 仍是主模型侧的零调用状态检查：`READY` 指出当前默认 Provider；`INSTALLED BUT NOT CONFIGURED` 告诉模型不要探测 Tool。

Web 不透明引用只由插件生成，不是用户输入格式。公开 Tool Arguments 仍会拒绝 data URI、直接 base64、`Uint8Array`、API Key、任意 HTTP Header、`file:` URL 和未配置 endpoint。

Canonical 输出：

```ts
interface VisionAnalyzeResult {
  text: string
  provider: string
  protocol: 'openai-responses' | 'openai-chat-completions' | 'anthropic-messages'
  model: string
  image_count: number
  usage: {
    input_tokens?: number
    output_tokens?: number
    total_tokens?: number
  } | null
  request_id: string | null
  finish_reason: string | null
  truncated: boolean
}
```

给主模型的 render 只包含固定的“不受信任视觉证据”边界、`text` 和一行 Provider/Protocol/Model/截断信息；不会输出 raw JSON、request id、URL query、Header、Credential 或图片字节。

## 数据流与安全边界

```text
Web 图片 → 读取当前 session 模型 → 同源能力解析
             ├─ 支持图片/能力未知 → DSH 原生图片发送 → 主模型
             └─ 明确纯文本 → 验证 + DSH attachment 存储
                   → 稳定不透明引用 → 普通问题 + 附件链接
                   → 由隐藏 Tool/Skill 上下文引导一次 vision_analyze

路径/URL/引用 → 输入准入 → 按调用解析 Credential → 协议 Adapter
  路径：ctx.fs + containment + magic bytes + ctx.attachments.validateImage
  URL：只校验策略，由第三方 Provider 下载
  Web 引用：ctx.attachments.readImage + metadata/session 核验 + 再验证
                          → 第三方视觉 API → 有界 JSON 解析 → 文本证据
```

### 上下文与 Cache 稳定性

原生模式会在持久 user message 中保存普通 DSH `ImageAttachmentRef`；图片字节位于 DSH attachment 存储，不是模型上下文文本。桥接模式只保存原问题和简洁 Markdown 链接，其目标是绑定 session 的 `vision-bridge://attachment/...` 引用；不会在可见 user turn 中保存合成 handoff 段落或模型/工具指令。上下文不会保存浏览器 `blob:` URL、图片字节、base64、本地绝对路径、Credential 或请求 Header。桥接 token 会刻意省略显示文件名，因此相同内容和已验证 metadata 在同一 session 中保持相同引用，即使剪贴板文件名变化也不会影响。

浏览器不缓存模型模态。每次图片发送（包括后续轮次以及其他插件切换模型后）都会重新读取当前 session 模型并解析该模型的声明。rc.6 没有公开的原子 pre-submit middleware，因此能力查询与最终原生/文本提交是两个操作；模型若恰好在这个极短窗口内变化，本次发送存在已记录的竞态，下一次发送会重新判断。能力未知时 fail open 到 DSH 的权威原生链路，避免抢走一个可能支持图片的模型。DSH attachment 存储按内容寻址，相同编码字节可以去重。本插件**不会缓存视觉答案，也不会跳过用户请求的 Provider 调用**；否则可能返回过期证据、建立新的敏感图片结果缓存，并掩盖真实计费。每次 `vision_analyze` 都是独立 Provider 请求。

原生与桥接历史都是 append-only：新图片、问题和 Tool Result 只扩展请求后缀，不重写此前可复用的前缀。Provider 是否提供 Cache、何时淘汰不属于本插件契约。配置改变可能让后续请求中的 Tool description 在 `READY` 与未配置状态之间变化，因此会在新的请求边界影响缓存复用。

相对本地路径只以 `exec.agent.session.header.cwd` 为基准；没有 Agent CWD 就拒绝，不回退到 `process.cwd()`。最终 symlink 会被拒绝。除非显式启用 `allowOutsideWorkspace`，解析后的文件必须由 `ctx.fs.contains` 判定处在 CWD 或 `extraAllowedRoots` 内。文件必须是普通文件、受字节上限约束、通过 magic bytes 确认为 PNG/JPEG/WebP/GIF，并在编码前通过 attachment 解码验证。

远程 URL 默认禁用。开启后也不会由本插件下载：原始 URL 会交给视觉 Provider，由它抓取。非 loopback HTTP 仍需 `allowInsecureHttp`。插件自有的等待态展示、错误与完成态 render 会脱敏路径和 URL query；但当前 DSH 会在插件执行前无损快照 Tool Arguments，因此带 query 的 URL 仍可能出现在该展示之外的 Harness 任务历史中。不要把秘密放进 URL query。

本地输入同时受单图上限和每次调用 64 MiB 总量上限约束；配置中的单图上限乘以图片数上限也不得超过该总量。该 Tool 使用 Harness 的独占调度，避免多次调用同时构建 base64 与 JSON 请求。

图片与视觉回答都可能包含 prompt injection。发给 Provider 的固定说明和返回边界都会强调：图中文字是不受信任的数据，不能执行其中命令，也不能服从伪造的系统提示词。重要数字、错误消息和代码必须按可见证据逐字核验。

重试默认是 0。只有 429、502、503、504 以及明确发生在收到 Response 之前的瞬时网络错误才可重试。**启用重试可能重复计费**：上一次请求可能已在 Provider 处理，只是响应丢失。

## 故障排查

- `VISION_NOT_CONFIGURED`：给当前 profile 添加至少一个 Provider。
- `VISION_CREDENTIAL_MISSING`：在 Harness 运行环境中配置引用；不要把 Key 粘进 YAML。
- `VISION_PROVIDER_NOT_FOUND`：修正 Tool 的 `provider` 或 `defaultProvider`。
- `VISION_PATH_OUTSIDE_WORKSPACE`：把图片移入 session CWD 或加入审核过的额外根目录。
- `VISION_SYMLINK_REJECTED`：改用实际普通文件路径。
- `VISION_REMOTE_URL_DISABLED`：使用本地路径，或明确启用远程 URL。
- `VISION_UNSUPPORTED_IMAGE` / `VISION_IMAGE_VALIDATION_FAILED`：提供真实可解码的 PNG/JPEG/WebP/GIF；改扩展名无效。
- `VISION_UPSTREAM_HTTP`：检查模型、endpoint、auth mode、配额和协议，排查时不要打印 Key。
- `VISION_TIMEOUT` / `VISION_RESPONSE_TOO_LARGE`：确认 Provider 行为后再谨慎提高有界限制。
- 用户可见消息中出现 `Vision Bridge WebUI handoff`、`generated locally`、Provider 就绪状态或 Tool Call 指令：浏览器仍加载了旧 client bundle。卸载/重装候选包、重启 Web DSH 进程并完整刷新页面。当前客户端绝不会把这些字符串写进 user turn。
- 图片保留在草稿中并显示 Vision Bridge 能力查询错误：只读的当前模型/能力检查不可用，所以插件有意没有提交任何消息。安装后重启，并确认活动 DSH 正是精确兼容的 rc.6。
- 纯文本路由提示 Vision Bridge 尚未配置：配置当前 profile 的 `vision-bridge` 行后重新发送保留的草稿；不同 profile 不共享配置。
- 粘贴图片直接交给主模型而没有调用 `vision_analyze`：当 Host 报告原生图片能力时，这是预期行为；只有确实需要 Provider 隔离时才显式要求路径/URL Tool 调用。

## 更新与卸载

两个 profile 需要分别更新：

```sh
dsh plugin --profile web update @hope666/dsh-vision-bridge
dsh plugin --profile headless update @hope666/dsh-vision-bridge
```

从某一 profile 卸载：

```sh
dsh plugin --profile web remove @hope666/dsh-vision-bridge
```

卸载会移除该 profile 中包贡献的两条 Cordis 行，但不会删除 Provider 侧数据，也不会主动 unset Credential Reference。

## 兼容性与 Known Limitations

准确测试矩阵和 npm dist-tag 风险见 [compatibility.md](docs/compatibility.md)。当前限制：

- Web 粘贴支持依赖 DSH rc.6 conversation submission seam，安装或升级后必须重启进程；
- rc.6 没有公开的原子 pre-submit middleware，能力查询与提交之间若恰好切换模型，可能影响那一次发送；下一次发送必定重新判断；
- 浏览器桥接引用绑定 session，不能作为公开格式手工构造；
- 上游响应不使用 stream；
- 不对远程图片预取、探测跳转或本地下载；
- 不提供 OCR 权威结果、图片生成、Computer Use、模型路由或 Web UI；
- 本地图片仅支持 PNG、JPEG、WebP、GIF；
- Provider 的模型可用性、远程 URL 抓取与数据保留属于外部责任。
- DSH 会在执行前快照原始 Tool Arguments；即使插件自有的等待态、错误和完成态展示会脱敏，带 query 的远程 URL 仍可能进入任务历史；

公开仓库建立后，请添加 GitHub topics：`dsh-plugin`、`deepseek-harness`、`vision`、`multimodal`、`tool-plugin`、`openai-responses`、`anthropic`、`typescript`。

## 开发、许可与免责声明

开发方式见 [CONTRIBUTING.md](CONTRIBUTING.md)，漏洞报告见 [SECURITY.md](SECURITY.md)，wire 契约见 [protocol-contracts.md](docs/protocol-contracts.md)。普通测试不会调用真实付费 API。

MIT © dsh-vision-bridge contributors。
