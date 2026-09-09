# 画布图契约

## 设计原则

- `type` 描述渲染与执行能力，`workflowKind` 描述漫剧业务用途。
- 内置与插件节点共用一种节点结构；插件类型继续使用 `<pluginId>:<name>`。
- 连线必须落到端口，端口声明数据类型、方向、数量和引用角色。
- 节点数据允许扩展，但稳定 ID、端口 ID 和已保存业务含义不可静默改变。

## 标准类型

```ts
type ContractVersion = 1;
type NodeTypeId = "text" | "image" | "video" | "audio" | "config" | "group" | (string & {});
type WorkflowKind =
  | "generic"
  | "story.idea" | "script.breakdown" | "storyboard.plan" | "prompt.optimize"
  | "skill.seedance" | "skill.custom"
  | "character.profile" | "character.turnaround" | "scene.profile" | "scene.candidate"
  | "scene.panorama" | "prop.image" | "composition.3d"
  | "frame.first" | "frame.last" | "frame.key" | "image.generate" | "image.edit" | "image.polish"
  | "video.t2v" | "video.i2v" | "video.flf2v" | "video.multiref" | "video.extend"
  | "audio.voice" | "audio.sfx" | "audio.music" | "subtitle" | "timeline.compose"
  | "output.final" | "utility.upload" | "utility.variable" | "utility.batch"
  | "utility.condition" | "utility.selector" | (string & {});

type PortDirection = "input" | "output";
type PortCardinality = "one" | "many";
type ResourceType = "text" | "prompt" | "image" | "video" | "audio" | "json" | "asset" | "timeline";
type ReferenceRole =
  | "data" | "identity" | "environment" | "composition" | "motion"
  | "first_frame" | "last_frame" | "video_input" | "audio_input" | "mask";

interface PortDefinition {
  id: string;
  label: string;
  direction: PortDirection;
  resourceTypes: ResourceType[];
  roles: ReferenceRole[];
  cardinality: PortCardinality;
  required?: boolean;
}

interface NodeDefinition {
  contractVersion: ContractVersion;
  type: NodeTypeId;
  workflowKind: WorkflowKind;
  title: string;
  description?: string;
  defaultSize: { width: number; height: number };
  ports: PortDefinition[];
  execution?: {
    capability: "none" | "text" | "image" | "video" | "audio" | "compose";
    mode?: "t2v" | "i2v" | "flf2v" | "multiref" | "extend";
  };
  defaults?: Record<string, unknown>;
}

interface CanvasNode {
  id: string;
  projectId: string;
  definitionId: string;
  definitionVersion: number;
  type: NodeTypeId;
  workflowKind: WorkflowKind;
  title: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  locked: boolean;
  groupId?: string;
  data: Record<string, unknown>;
  activeAssetVersionIds: string[];
  createdAt: string;
  updatedAt: string;
}

interface CanvasEdge {
  id: string;
  projectId: string;
  sourceNodeId: string;
  sourcePortId: string;
  targetNodeId: string;
  targetPortId: string;
  resourceType: ResourceType;
  role: ReferenceRole;
  order: number;
  metadata?: Record<string, unknown>;
  createdAt: string;
}
```

`definitionId` 是稳定注册表 ID；`definitionVersion` 用于读取旧快照。`workflowKind` 是开放字符串，但内置用途统一使用带命名空间的小写值。

## 端口兼容规则

建立连线前必须同时满足：

1. 起点是 `output`，终点是 `input`。
2. 两端 `resourceTypes` 至少有一个交集。
3. 连线 `role` 同时被两端允许。
4. `one` 端口已有连线时，新连线需要用户确认替换，不能静默叠加。
5. 同一节点不能自连；默认拒绝形成执行环，只有显式声明支持反馈的工具节点例外。
6. 删除节点时软删除相关边；恢复节点时仅恢复仍满足契约的边。

同一目标端口的多输入按 `order` 稳定排序，首帧/尾帧不能依靠画布位置推断。

## 视频节点端口

- `video.t2v`：必需 `prompt`；不接受参考媒体。
- `video.i2v`：必需 `prompt` 和一个 `first_frame`；可选 `audio_input`。
- `video.flf2v`：必需 `prompt`、一个 `first_frame`、一个 `last_frame`；可选 `audio_input`。
- `video.multiref`：必需 `prompt`；`identity`、`environment`、`composition`、`motion`、`video_input`、`audio_input` 可多路输入，最终数量由模型能力表限制。

模式由节点定义或用户明确选择，禁止仅根据“图片数量大于 2”在请求时临时猜测。

## 旧数据无损映射

读取当前 `CanvasNodeData` 时使用以下默认映射；原始 `metadata` 原样保留在 `data.legacyMetadata`，迁移成功前不删除 IndexedDB 数据。

- `text` → `type=text`、`workflowKind=generic`，默认端口 `text.out`。
- `image` → `type=image`、`workflowKind=image.generate`，输入 `prompt.in`/`image.reference`，输出 `image.out`。
- `video` → `type=video`；按旧 `videoMode` 映射 `video.flf2v` 或 `video.multiref`，无法判断时映射 `video.i2v` 并标记 `migrationNeedsReview=true`。
- `audio` → `type=audio`、`workflowKind=audio.voice`，输出 `audio.out`。
- `config` → `type=config`、`workflowKind=generic`，只保存非敏感参数；旧 API Key、渠道凭据和代理凭据不迁移。
- `group` → `type=group`、`workflowKind=generic`，成员关系映射到 `groupId`。
- 插件节点保留原开放类型；若注册表缺失，显示只读占位节点，不丢弃其数据。

旧 `CanvasConnection` 映射时：

- 起点使用定义中的首个兼容输出端口，终点使用首个兼容输入端口。
- 能从资源类型唯一判断时写入对应 `resourceType` 和 `role`。
- 无法唯一判断时写入 `data` 角色并标记 `migrationNeedsReview=true`；不能删除连线。

## 快照与并发

- 画布保存包含 `contractVersion`、节点、边、视口和单调递增 `revision`。
- 更新请求携带客户端最后看到的 `revision`；不匹配返回冲突，不能用旧页面静默覆盖新页面。
- 服务端事务内保存节点、边、视口并创建快照。
- IndexedDB 在第 2 部分降级为缓存；云端保存确认前显示“未同步”。

