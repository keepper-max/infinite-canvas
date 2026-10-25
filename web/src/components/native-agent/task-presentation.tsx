import { Button, Collapse, Tag } from "antd";
import type { AgentTaskPresentation } from "@/services/api/native-agent";
export default function TaskPresentation({ task, canFocus, onFocus }: { task: AgentTaskPresentation; canFocus: boolean; onFocus: (ids: string[]) => void }) {
    return (
        <section aria-label="任务进度" className="my-5 border-y border-border py-4">
            <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-medium">{task.displayTitle}</h3>
                <Tag>{task.statusLabel}</Tag>
            </div>
            <p className="my-3 text-sm leading-6" role="status">
                {task.summary}
            </p>
            {task.result && (
                <div aria-label="任务结果" className="space-y-2 text-sm">
                    {task.result.knowledgeCount > 0 && <p>已关联资料：{task.result.knowledgeCount} 份</p>}
                    {task.result.textCount > 0 && <p>已创建文本节点：{task.result.textCount} 个</p>}
                    {task.result.edgeCount > 0 && <p>已建立连接：{task.result.edgeCount} 条</p>}
                    {!!task.result.updatedNodes?.length && <p>已更新文本节点：{task.result.updatedNodes.length} 个</p>}
                    <p>保存状态：已保存</p>
                    <ul className="space-y-1 break-words text-xs text-muted-foreground">
                        {task.result.nodes.map((n) => (
                            <li key={n.id}>{n.title}</li>
                        ))}
                    </ul>
                    {!!(task.result.nodes.length || task.result.updatedNodes?.length) && (
                        <Button type="text" disabled={!canFocus} title={canFocus ? undefined : "请先打开对应画布再定位"} onClick={() => onFocus([...task.result!.nodes, ...(task.result!.updatedNodes ?? [])].map((n) => n.id))}>
                            {task.result.nodes.length ? "定位创建结果" : "定位修改结果"}
                        </Button>
                    )}
                </div>
            )}
            {!!task.progressItems.length && (
                <Collapse
                    ghost
                    items={[
                        {
                            key: "progress",
                            label: "展开执行详情",
                            children: (
                                <ol className="space-y-3 text-xs">
                                    {task.progressItems.map((p) => (
                                        <li key={p.key} className="flex justify-between gap-4">
                                            <span className="min-w-0 break-words">{p.title}</span>
                                            <span className="shrink-0 text-muted-foreground">{p.statusLabel}</span>
                                        </li>
                                    ))}
                                </ol>
                            ),
                        },
                    ]}
                />
            )}
        </section>
    );
}
