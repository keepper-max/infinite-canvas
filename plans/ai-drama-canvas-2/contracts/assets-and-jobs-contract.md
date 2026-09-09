# 资产版本与任务契约

## 资产与版本

`Asset` 表示业务对象，`AssetVersion` 表示一次不可变结果。角色、场景、道具、图片、视频、音频、字幕和成片都使用同一版本机制。

```ts
type AssetKind = "character" | "scene" | "prop" | "image" | "video" | "audio" | "subtitle" | "project_export";
type AssetStatus = "active" | "trashed";

interface Asset {
  id: string;
  projectId: string;
  kind: AssetKind;
  name: string;
  currentVersionId?: string;
  status: AssetStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  trashedAt?: string;
}

interface AssetVersion {
  id: string;
  assetId: string;
  version: number;
  storageKey: string;
  mimeType: string;
  bytes: number;
  width?: number;
  height?: number;
  durationMs?: number;
  sha256: string;
  source: "upload" | "generation" | "edit" | "compose" | "migration";
  sourceJobId?: string;
  parentVersionIds: string[];
  provenance: {
    modelId?: string;
    modelRevision?: string;
    skillId?: string;
    skillVersion?: string;
    promptSnapshotId?: string;
    inputAssetVersionIds: string[];
    parameters: Record<string, unknown>;
  };
  createdBy: string;
  createdAt: string;
}
```

规则：

- 新生成、编辑、合成和重新上传都创建新 `AssetVersion`，禁止覆盖已有对象。
- `currentVersionId` 只是主版本指针；切换主版本不修改历史任务输入。
- 任务必须绑定确切的 `AssetVersion.id`，不能只绑定会变化的 `Asset.id`。
- 同一资产内 `version` 单调递增，并由数据库唯一约束保证。
- 删除资产先进入回收站；真实删除需要单独的保留期和引用检查。
- 对象存储键由服务端生成，浏览器不得自行指定任意路径。
- 临时 Provider URL 不作为最终 `storageKey`；Worker 必须在过期前转存。

## 任务输入快照

```ts
interface GenerationJobInput {
  contractVersion: 1;
  projectId: string;
  nodeId: string;
  nodeRevision: number;
  capability: "text" | "image" | "video" | "audio" | "compose";
  mode?: "t2v" | "i2v" | "flf2v" | "multiref" | "extend";
  modelId: string;
  promptSnapshotId?: string;
  parameters: Record<string, unknown>;
  references: Array<{
    assetVersionId: string;
    role: "identity" | "environment" | "composition" | "motion" | "first_frame" | "last_frame" | "video_input" | "audio_input" | "mask";
    order: number;
  }>;
}
```

创建任务后输入快照不可变；用户改节点或换主版本不会改变已运行任务。

## 状态机

```ts
type JobStatus =
  | "pending"
  | "queued"
  | "submitting"
  | "running"
  | "downloading"
  | "persisting"
  | "completed"
  | "retrying"
  | "cancel_requested"
  | "cancelled"
  | "failed";
```

允许转换：

- `pending` → `queued`、`cancelled`、`failed`
- `queued` → `submitting`、`cancel_requested`、`failed`
- `submitting` → `running`、`downloading`、`cancel_requested`、`failed`
- `running` → `downloading`、`cancel_requested`、`failed`
- `downloading` → `persisting`、`cancel_requested`、`failed`
- `persisting` → `completed`、`cancel_requested`、`failed`
- `failed` → `retrying`
- `retrying` → `queued`、`cancel_requested`、`failed`
- `cancel_requested` → `cancelled`、`failed`
- `completed`、`cancelled` 为终态。

不在表内的转换一律拒绝。Worker 收到迟到的 Provider 成功回调时，如果任务已是 `cancel_requested` 或 `cancelled`，可以转存产物到隔离区供管理员追查，但不能把任务改回成功或绑定到节点。

## 状态字段

任务至少记录：

- 内部任务 ID、BullMQ job ID、Provider 任务 ID。
- 当前状态、阶段进度 `0–100`、尝试次数和最大尝试次数。
- 输入快照、能力过滤后的请求快照和脱敏响应摘要。
- 原始错误代码、用户可见中文错误、是否可重试。
- 创建、入队、开始、结束和最后心跳时间。
- 输出 `AssetVersion.id` 列表。
- `creditReserved`、`creditCharged` 字段保留但本阶段不扣费。

## 幂等与重试

- 创建任务使用 `idempotencyKey = projectId + nodeId + nodeRevision + requestFingerprint`，数据库唯一约束与 BullMQ `jobId` 双重防重。
- `requestFingerprint` 对模型 ID、模式、提示词快照、参数和有序参考版本做稳定哈希。
- 同一幂等键返回已有任务，不创建第二条。
- 仅 `failed` 且 `retryable=true` 的任务可重试；每次重试建立 `job_attempt`，任务 ID 不变。
- Provider 已接受但本地超时的情况先查询原 Provider 任务，禁止盲目再次提交。
- 取消是请求，不是瞬间成功；只有 Worker 停止后进入 `cancelled`。

## 事件契约

```ts
interface JobEvent<T = Record<string, unknown>> {
  eventId: string;
  sequence: number;
  type:
    | "job.created" | "job.queued" | "job.started" | "job.progress"
    | "job.downloading" | "job.persisting" | "job.completed"
    | "job.failed" | "job.retrying" | "job.cancel_requested" | "job.cancelled";
  occurredAt: string;
  projectId: string;
  jobId: string;
  nodeId: string;
  status: JobStatus;
  progress: number;
  data: T;
}
```

- 事件先写 PostgreSQL，再发布 Redis；数据库是恢复权威。
- 同一任务 `sequence` 单调递增；前端忽略重复或倒序事件。
- SSE 断线后使用 `Last-Event-ID` 补发；若历史已清理，前端重新获取任务快照。
- 事件 `data` 不包含密钥、完整上游响应或临时签名凭据。

