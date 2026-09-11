import { App, Button, Card, Empty, Input, Modal, Select, Spin, Tag } from "antd";
import { Activity, Boxes, Coins, CreditCard, History, MessageSquareText, Plus, RefreshCw, Users } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { getProductUpdates } from "@/constant/product-updates";
import { formatBytes } from "@/lib/image-utils";
import { APP_VERSION } from "@/constant/env";
import {
    addTeamMember,
    attachTeamProject,
    createTeam,
    getAdminFailures,
    getAdminModels,
    getAdminOverview,
    getCreditAccount,
    getOperationsCapabilities,
    isAdminForbidden,
    listTeamMembers,
    listTeams,
    type AdminFailure,
    type AdminModel,
    type AdminOverview,
    type CreditAccount,
    type OperationsCapabilities,
    type Team,
    type TeamMember,
} from "@/services/api/operations";
import { listProjects, type ProjectSummary } from "@/services/api/platform";

export default function OperationsPage() {
    const { message } = App.useApp();
    const { i18n } = useTranslation();
    const [loading, setLoading] = useState(true);
    const [capabilities, setCapabilities] = useState<OperationsCapabilities>();
    const [account, setAccount] = useState<CreditAccount>();
    const [teams, setTeams] = useState<Team[]>([]);
    const [projects, setProjects] = useState<ProjectSummary[]>([]);
    const [admin, setAdmin] = useState<AdminOverview>();
    const [failures, setFailures] = useState<AdminFailure[]>([]);
    const [models, setModels] = useState<AdminModel[]>([]);
    const [teamOpen, setTeamOpen] = useState(false);
    const [teamName, setTeamName] = useState("");
    const [managedTeam, setManagedTeam] = useState<Team>();
    const [members, setMembers] = useState<TeamMember[]>([]);
    const [memberEmail, setMemberEmail] = useState("");
    const [memberRole, setMemberRole] = useState<"admin" | "editor" | "viewer">("editor");
    const [projectId, setProjectId] = useState<string>();
    const productUpdates = getProductUpdates(i18n.resolvedLanguage);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [nextCapabilities, nextAccount, nextTeams, nextProjects] = await Promise.all([getOperationsCapabilities(), getCreditAccount(), listTeams(), listProjects()]);
            setCapabilities(nextCapabilities);
            setAccount(nextAccount);
            setTeams(nextTeams);
            setProjects(nextProjects);
            try {
                const [overview, failed, catalog] = await Promise.all([getAdminOverview(), getAdminFailures(), getAdminModels()]);
                setAdmin(overview);
                setFailures(failed);
                setModels(catalog);
            } catch (error) {
                if (!isAdminForbidden(error)) throw error;
                setAdmin(undefined);
                setFailures([]);
                setModels([]);
            }
        } catch (error) {
            message.error(error instanceof Error ? error.message : "运营信息加载失败");
        } finally {
            setLoading(false);
        }
    }, [message]);

    useEffect(() => void load(), [load]);

    const submitTeam = async () => {
        if (!teamName.trim()) return;
        try {
            await createTeam(teamName.trim());
            setTeamName("");
            setTeamOpen(false);
            await load();
            message.success("团队已创建");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "团队创建失败");
        }
    };

    const openTeam = async (team: Team) => {
        try {
            setManagedTeam(team);
            setMembers(await listTeamMembers(team.id));
        } catch (error) {
            message.error(error instanceof Error ? error.message : "团队成员加载失败");
        }
    };

    const submitMember = async () => {
        if (!managedTeam || !memberEmail.trim()) return;
        try {
            await addTeamMember(managedTeam.id, memberEmail.trim(), memberRole);
            setMembers(await listTeamMembers(managedTeam.id));
            setMemberEmail("");
            message.success("成员权限已更新");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "成员更新失败");
        }
    };

    const submitProject = async () => {
        if (!managedTeam || !projectId) return;
        try {
            await attachTeamProject(managedTeam.id, projectId);
            message.success("项目已加入团队");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "项目关联失败");
        }
    };

    if (loading && !capabilities)
        return (
            <div className="flex h-full items-center justify-center">
                <Spin />
            </div>
        );
    return (
        <main className="h-full overflow-y-auto px-6 py-8">
            <div className="mx-auto max-w-6xl space-y-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-semibold">平台与团队</h1>
                        <p className="mt-1 text-sm text-stone-500">查看平台能力、积分占位、团队和运行状态。</p>
                    </div>
                    <Button type="text" icon={<RefreshCw className="size-4" />} onClick={() => void load()}>
                        刷新
                    </Button>
                </div>
                <div className="grid gap-4 md:grid-cols-3">
                    <CapabilityCard icon={<MessageSquareText />} title="短信" enabled={capabilities?.sms} />
                    <CapabilityCard icon={<Coins />} title="积分扣费" enabled={capabilities?.credits} detail={`余额 ${account?.account.balance || 0}`} />
                    <CapabilityCard icon={<CreditCard />} title="在线支付" enabled={capabilities?.payments} />
                </div>
                <Card
                    title={
                        <span className="flex items-center gap-2">
                            <Users className="size-4" />
                            团队
                        </span>
                    }
                    extra={
                        <Button type="text" icon={<Plus className="size-4" />} onClick={() => setTeamOpen(true)}>
                            新建团队
                        </Button>
                    }
                >
                    {teams.length ? (
                        <div className="grid gap-3 md:grid-cols-2">
                            {teams.map((team) => (
                                <div key={team.id} className="rounded-xl border border-stone-200 p-4 dark:border-stone-800">
                                    <div className="font-medium">{team.name}</div>
                                    <div className="mt-2 flex items-center justify-between text-xs text-stone-500">
                                        <span>权限：{team.role}</span>
                                        <Button size="small" onClick={() => void openTeam(team)}>管理</Button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有团队" />
                    )}
                </Card>
                {admin ? (
                    <Card
                        title={
                            <span className="flex items-center gap-2">
                                <Activity className="size-4" />
                                管理员概览
                            </span>
                        }
                    >
                        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                            <Metric label="用户" value={admin.users} />
                            <Metric label="项目" value={admin.projects} />
                            <Metric label="素材" value={admin.assets} />
                            <Metric label="素材容量" value={formatBytes(admin.assetBytes)} />
                            <Metric label="生成中" value={admin.activeJobs} />
                            <Metric label="生成失败" value={admin.failedJobs} />
                            <Metric label="合成中" value={admin.activeCompositions} />
                            <Metric label="合成失败" value={admin.failedCompositions} />
                        </div>
                        <div className="mt-5 flex items-center gap-2 text-sm">
                            <Boxes className="size-4" />
                            模型目录 {models.length} 个，已启用 {models.filter((model) => model.enabled).length} 个，健康 {models.filter((model) => model.healthy).length} 个
                        </div>
                        <div className="mt-5 overflow-hidden rounded-2xl border border-stone-200 bg-stone-50 dark:border-stone-800 dark:bg-stone-950/60">
                            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-200 px-4 py-3 dark:border-stone-800">
                                <span className="flex items-center gap-2 font-medium">
                                    <History className="size-4" />
                                    内部发布信息
                                </span>
                                <div className="flex items-center gap-2">
                                    <Tag color="gold">仅管理员可见</Tag>
                                    <code className="rounded-md bg-stone-900 px-2 py-1 text-xs text-stone-100 dark:bg-stone-100 dark:text-stone-900">{APP_VERSION}</code>
                                </div>
                            </div>
                            <div className="p-4">
                                <div className="mb-3 text-xs uppercase tracking-[0.18em] text-stone-400">当前更新内容</div>
                                <div className="space-y-2">
                                    {productUpdates.map((item) => (
                                        <div key={item.title} className="flex items-start gap-2 text-sm leading-6 text-stone-700 dark:text-stone-300">
                                            <Tag className="m-0 mt-0.5 shrink-0">{item.type}</Tag>
                                            <span>
                                                <strong>{item.title}</strong>
                                                <span className="text-stone-500 dark:text-stone-400"> · {item.description}</span>
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                        {failures.length ? (
                            <div className="mt-5 space-y-2">
                                {failures.slice(0, 10).map((failure) => (
                                    <div key={`${failure.kind}-${failure.id}`} className="rounded-lg border border-stone-200 p-3 text-sm dark:border-stone-800">
                                        <Tag color="error">{failure.kind}</Tag>
                                        {failure.error.message}
                                    </div>
                                ))}
                            </div>
                        ) : null}
                    </Card>
                ) : null}
            </div>
            <Modal title="新建团队" open={teamOpen} okText="创建" cancelText="取消" onOk={() => void submitTeam()} onCancel={() => setTeamOpen(false)}>
                <Input value={teamName} maxLength={100} placeholder="团队名称" onChange={(event) => setTeamName(event.target.value)} />
            </Modal>
            <Modal title={managedTeam ? `管理 ${managedTeam.name}` : "管理团队"} open={Boolean(managedTeam)} footer={null} onCancel={() => setManagedTeam(undefined)}>
                <div className="space-y-5">
                    <div>
                        <div className="mb-2 text-sm font-medium">成员</div>
                        <div className="space-y-2">{members.map((member) => <div key={member.userId} className="flex justify-between rounded-lg bg-stone-100 px-3 py-2 text-sm dark:bg-stone-900"><span>{member.email}</span><Tag>{member.role}</Tag></div>)}</div>
                    </div>
                    {managedTeam && ["owner", "admin"].includes(managedTeam.role) ? <>
                        <div>
                            <div className="mb-2 text-sm font-medium">添加或更新成员</div>
                            <div className="flex gap-2"><Input value={memberEmail} placeholder="已注册邮箱" onChange={(event) => setMemberEmail(event.target.value)} /><Select value={memberRole} className="w-28" options={[{ value: "admin", label: "管理员" }, { value: "editor", label: "编辑" }, { value: "viewer", label: "只读" }]} onChange={setMemberRole} /><Button type="primary" onClick={() => void submitMember()}>保存</Button></div>
                        </div>
                        <div>
                            <div className="mb-2 text-sm font-medium">关联我拥有的项目</div>
                            <div className="flex gap-2"><Select value={projectId} className="flex-1" placeholder="选择项目" options={projects.filter((project) => project.role === "owner").map((project) => ({ value: project.projectId, label: project.projectTitle }))} onChange={setProjectId} /><Button onClick={() => void submitProject()}>关联</Button></div>
                        </div>
                    </> : null}
                </div>
            </Modal>
        </main>
    );
}

function CapabilityCard({ icon, title, enabled, detail }: { icon: React.ReactNode; title: string; enabled?: boolean; detail?: string }) {
    return (
        <Card>
            <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 [&_svg]:size-4">
                    {icon}
                    {title}
                </span>
                <Tag color={enabled ? "success" : "default"}>{enabled ? "已启用" : "接口已预留"}</Tag>
            </div>
            {detail ? <div className="mt-4 text-2xl font-semibold">{detail}</div> : <div className="mt-4 text-sm text-stone-500">接入服务商后启用</div>}
        </Card>
    );
}
function Metric({ label, value }: { label: string; value: string | number }) {
    return (
        <div className="rounded-xl bg-stone-100 p-4 dark:bg-stone-900">
            <div className="text-xs text-stone-500">{label}</div>
            <div className="mt-1 text-xl font-semibold">{value}</div>
        </div>
    );
}
