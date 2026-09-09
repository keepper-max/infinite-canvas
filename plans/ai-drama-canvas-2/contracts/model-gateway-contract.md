# 模型网关契约

## 模型注册

模型公开名称、上游名称和 Provider 配置分离：

```ts
type ModelCapability = "text" | "image" | "video" | "audio";
type VideoMode = "t2v" | "i2v" | "flf2v" | "multiref" | "extend";

interface ModelDefinition {
  id: string;                 // 内部稳定 ID，例如 video.seedance-2-5
  displayName: string;        // 用户可见名称
  providerId: string;         // 仅服务端使用
  upstreamModel: string;      // 仅服务端使用
  capability: ModelCapability;
  enabled: boolean;
  modes: VideoMode[];
  acceptedParameters: string[];
  requiredParametersByMode: Partial<Record<VideoMode, string[]>>;
  limits: {
    durations?: number[];
    resolutions?: string[];
    aspectRatios?: string[];
    maxImages?: number;
    maxVideos?: number;
    maxAudios?: number;
    maxPromptChars?: number;
  };
  parameterMap: Record<string, string>;
  overridesVersion: number;
}
```

前端目录只返回：`id`、`displayName`、`capability`、`modes`、公开限制和可配置项；不返回 `providerId`、`upstreamModel`、Base URL、密钥或内部脚本。

## 目录来源

- 上游公开目录只提供候选模型和粗能力。
- 服务端人工覆盖表提供模式、字段映射、限制、禁用状态和已验证版本。
- 只有“目录存在 + 覆盖表启用 + 健康检查通过”的模型可供普通用户选择。
- 未识别模型默认隐藏，不能靠名称关键词直接开放真实调用。
- 当前浏览器内 `ChannelModel.supportedParameters` 在第 4 部分迁移到服务端定义；旧配置只作为一次性映射来源。

## 请求编译流水线

```text
节点输入
→ 图契约校验
→ 解析具体 AssetVersion
→ 选择 ModelDefinition
→ 模式校验
→ 规范化通用参数
→ 按 acceptedParameters 白名单过滤
→ 按 parameterMap 转换上游字段
→ Provider 适配器提交
```

规则：

1. 业务层只生成通用参数，不直接拼上游请求。
2. 未在 `acceptedParameters` 中的参数丢弃并记内部审计，不发送给上游。
3. 缺少模式必需字段时在本地失败，不消耗上游任务。
4. 参数超出限制时返回可操作的中文错误；禁止静默截断会改变创作意图的值。
5. 默认值由服务端能力版本决定，并写入任务请求快照。
6. Provider 原始错误只进脱敏管理员日志；用户收到稳定错误码与中文解释。

## 四类视频模式

### T2V

- 输入：提示词。
- 禁止发送首帧、尾帧、多参考任务类型和空参考数组。
- 仅发送模型声明支持的时长、比例、清晰度、声音、水印等参数。

### I2V

- 输入：提示词 + 一个 `first_frame`。
- 不发送 `last_frame` 或多参考任务类型。
- 模型只支持通用图片字段时，由 Provider 映射首帧字段。

### FLF2V

- 输入：提示词 + 一个 `first_frame` + 一个 `last_frame`。
- 两帧顺序由连线角色决定，不依赖上传顺序。
- 只有能力表包含 `flf2v` 时才允许提交。

### Multi-reference

- 输入：提示词 + 一个或多个带明确角色的图片/视频/音频版本。
- 只有模式包含 `multiref` 时才发送上游多参考任务类型字段。
- 参考数量、媒体组合和角色映射按能力表校验。

这条规则修正现有“图片数量推断模式”的不稳定行为，并避免向普通文生视频或首尾帧任务发送仅多参考支持的字段。

## Provider 接口

```ts
interface GenerationProvider {
  create(input: CompiledGenerationRequest): Promise<{
    providerJobId?: string;
    status: "pending" | "running" | "completed";
    artifacts?: ProviderArtifact[];
  }>;
  get(providerJobId: string): Promise<ProviderJobState>;
  cancel(providerJobId: string): Promise<void>;
  fetchArtifact(providerJobId: string): Promise<ReadableStream>;
}
```

- Web 不直接调用 Provider。
- Worker 是创建、轮询、取消和下载 Provider 结果的唯一调用方。
- Provider 适配器无权修改画布；只返回标准状态和产物。
- 同步文本/图片接口可在 `create` 时直接返回 `completed` 和产物；异步接口必须返回可持久化的 `providerJobId`。
- 密钥由 `providerId` 在服务器密钥存储中解析，永不进入任务 JSON。

## 错误分类

- `MODEL_NOT_AVAILABLE`：模型未启用或目录健康失败。
- `MODE_NOT_SUPPORTED`：模型不支持所选生成模式。
- `INVALID_MODEL_PARAMETER`：参数或参考不符合能力表。
- `PROVIDER_AUTH_FAILED`：服务端凭据或权限异常，仅管理员看到诊断详情。
- `PROVIDER_RATE_LIMITED`：可按策略重试。
- `PROVIDER_REJECTED`：内容审核或上游业务拒绝。
- `PROVIDER_UNAVAILABLE`：网络或服务异常，可按策略重试。
- `ARTIFACT_DOWNLOAD_FAILED`：生成完成但下载/转存失败，可从原 Provider 任务恢复。
