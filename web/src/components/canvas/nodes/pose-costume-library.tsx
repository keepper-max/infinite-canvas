import { useEffect, useState } from "react";
import { Button, Checkbox, Empty, Image, Input, Modal, Select, Spin, Tabs } from "antd";
import { useQuery } from "@tanstack/react-query";
import { Heart } from "lucide-react";
import { libraryImagePolicy, poseDepthReference, matchesLibraryQuery, REFERENCE_ROLES, REFERENCE_ROLE_LABELS } from "@/lib/canvas/pose-costume";
import { PERSONAL_REFERENCE_TRIAL } from "@/constant/env";
import { loadReferenceCatalog } from "@/services/api/pose-costume";
import type { LibraryReference, LibraryVariant } from "@/types/pose-costume";

const actionClass = "rounded px-2 py-1 text-xs transition hover:bg-black/5 disabled:opacity-40 dark:hover:bg-white/10";

export function ReferenceBrowser({ favorites, onFavorite, onChoose, disabled }: { favorites: string[]; onFavorite: (id: string) => void; onChoose: (item: LibraryReference, variant: LibraryVariant, insert: boolean) => void; disabled: boolean }) {
    const catalog = useQuery({ queryKey: ["pose-costume-catalog"], queryFn: ({ signal }) => loadReferenceCatalog(signal), retry: false });
    const [kind, setKind] = useState("character");
    const [keyword, setKeyword] = useState("");
    const [category, setCategory] = useState("");
    const [hair, setHair] = useState("");
    const [extended, setExtended] = useState(false);
    const [saved, setSaved] = useState(false);
    const [sort, setSort] = useState("curated");
    const [visible, setVisible] = useState(24);
    const [detail, setDetail] = useState<LibraryReference>();
    const [variantIndex, setVariantIndex] = useState(0);
    const [depth, setDepth] = useState(false);
    const [about, setAbout] = useState(false);
    const items = catalog.data || [];
    const categories = [...new Map(items.filter((item) => item.kind === kind).map((item) => [item.category.id, item.category])).values()];
    const hairs = [...new Map(items.filter((item) => item.portrait).map((item) => [item.portrait!.hair, item.series.zh])).entries()];
    const filtered = items.filter(
        (item) => item.kind === kind && (extended || !item.extended) && (!category || item.category.id === category) && (!hair || item.portrait?.hair === hair) && (!saved || favorites.includes(item.id)) && matchesLibraryQuery(item, keyword),
    );
    if (sort !== "curated") filtered.sort((a, b) => (sort === "code" ? a.id.localeCompare(b.id, undefined, { numeric: true }) : sort === "en" ? a.title.en.localeCompare(b.title.en) : a.title.zh.localeCompare(b.title.zh, "zh-CN")));
    useEffect(() => setVisible(24), [kind, keyword, category, hair, extended, saved, sort]);
    const selectedDetail = detail && depth ? poseDepthReference(detail) : detail;
    const variant = selectedDetail?.variants[variantIndex];
    return (
        <div className="min-w-0 space-y-3">
            <div className="flex items-center justify-between">
                <span className="text-xs opacity-60">
                    已核验目录 · {items.length} 项 / {items.reduce((total, item) => total + item.variants.length, 0)} 个视角
                </span>
                <button className={actionClass} onClick={() => setAbout(true)}>
                    来源与授权
                </button>
            </div>
            <Tabs
                activeKey={kind}
                onChange={(value) => {
                    setKind(value);
                    setCategory("");
                    setHair("");
                }}
                items={REFERENCE_ROLES.map((role) => ({ key: role, label: `${REFERENCE_ROLE_LABELS[role]} ${items.filter((item) => item.kind === role).length}` }))}
            />
            <Input.Search aria-label="参考库搜索" placeholder="中英文名称、关键词、编号；空格组合搜索" value={keyword} onChange={(event) => setKeyword(event.target.value)} allowClear />
            <div className="flex flex-wrap gap-2">
                <Select aria-label="素材分类" value={category} onChange={setCategory} className="min-w-32" options={[{ value: "", label: "全部分类" }, ...categories.map((value) => ({ value: value.id, label: value.zh }))]} />
                {kind === "character" && <Select aria-label="发长" value={hair} onChange={setHair} options={[{ value: "", label: "全部发长" }, ...hairs.map(([value, label]) => ({ value, label }))]} />}
                <Select
                    aria-label="参考排序"
                    value={sort}
                    onChange={setSort}
                    options={[
                        { value: "curated", label: "原目录顺序" },
                        { value: "zh", label: "中文名称" },
                        { value: "en", label: "英文名称" },
                        { value: "code", label: "编号" },
                    ]}
                />
                <Checkbox checked={saved} onChange={(event) => setSaved(event.target.checked)}>
                    仅收藏
                </Checkbox>
                {kind !== "character" && (
                    <Checkbox checked={extended} onChange={(event) => setExtended(event.target.checked)}>
                        扩展分类
                    </Checkbox>
                )}
            </div>
            {kind !== "character" && (
                <p className="text-xs leading-5 opacity-65">
                    {PERSONAL_REFERENCE_TRIAL ? "本地个人参考试用：图片按需读取原站，选中的原图可加入搭配；不提供整库下载或公开镜像。" : "此分类已接入全部目录与视角。图片展示与导入待授权；本地开发环境可个人逐张参考试用。"}
                </p>
            )}
            <p className="text-xs opacity-60">筛选结果 {filtered.length} 项</p>
            <div className="max-h-[65vh] overflow-y-auto pr-1">
                {catalog.isPending ? (
                    <Spin />
                ) : catalog.isError ? (
                    <div role="alert">
                        <p>{catalog.error.message}</p>
                        <Button onClick={() => void catalog.refetch()}>重新读取目录</Button>
                    </div>
                ) : !filtered.length ? (
                    <Empty description="没有匹配的参考" />
                ) : (
                    <div className="grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3">
                        {filtered.slice(0, visible).map((item) => {
                            const policy = libraryImagePolicy(item, PERSONAL_REFERENCE_TRIAL);
                            return (
                                <article key={item.id} className="min-w-0">
                                    <button
                                        className="block w-full text-left"
                                        onClick={() => {
                                            setDetail(item);
                                            setVariantIndex(0);
                                            setDepth(false);
                                        }}
                                    >
                                        {policy.allowed ? (
                                            <img src={item.variants[0].thumbnail} alt={item.title.zh} className="aspect-[3/4] w-full rounded object-contain" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
                                        ) : (
                                            <div className="flex min-h-24 flex-col justify-center gap-2 py-4 text-xs">
                                                <span className="text-base font-medium">{item.code}</span>
                                                <span>{item.variants.length} 个视角 · 图片待授权</span>
                                            </div>
                                        )}
                                        <p className="mt-2 line-clamp-2 text-xs font-medium">{item.title.zh}</p>
                                        <p className="mt-1 truncate text-[11px] opacity-50">{item.title.en}</p>
                                    </button>
                                    <div className="mt-1 flex items-center justify-between">
                                        <span className="truncate text-[10px] opacity-60">{item.code}</span>
                                        <button className={actionClass} disabled={disabled} aria-label={`${favorites.includes(item.id) ? "取消收藏" : "收藏"} ${item.code}`} onClick={() => onFavorite(item.id)}>
                                            <Heart className="size-3.5" fill={favorites.includes(item.id) ? "currentColor" : "none"} />
                                        </button>
                                    </div>
                                </article>
                            );
                        })}
                    </div>
                )}
                {visible < filtered.length && (
                    <button className={`${actionClass} my-4 w-full`} onClick={() => setVisible((value) => value + 24)}>
                        继续加载（{Math.min(visible, filtered.length)} / {filtered.length}）
                    </button>
                )}
            </div>
            <Modal open={Boolean(detail)} title={detail ? `${detail.title.zh} · ${detail.code}` : "素材详情"} onCancel={() => setDetail(undefined)} footer={null}>
                {detail && variant && (
                    <div className="space-y-3">
                        <p className="text-xs opacity-60">{detail.title.en}</p>
                        {libraryImagePolicy(detail, PERSONAL_REFERENCE_TRIAL).allowed ? <Image src={variant.original} alt={detail.title.zh} referrerPolicy="no-referrer" /> : <p className="text-sm">图片待授权，未向原站请求缩略图或原图。</p>}
                        {detail.kind === "pose" && PERSONAL_REFERENCE_TRIAL && (
                            <div className="space-y-1">
                                <Checkbox checked={depth} onChange={(event) => setDepth(event.target.checked)}>
                                    深度图参考
                                </Checkbox>
                                {depth && <p className="text-xs opacity-60">作为普通多图参考提交，不启用 ControlNet 深度控制。</p>}
                            </div>
                        )}
                        <Select aria-label="参考视角" className="w-full" value={variantIndex} onChange={setVariantIndex} options={detail.variants.map((value, index) => ({ value: index, label: `${value.label.zh} / ${value.label.en} · ${value.id}` }))} />
                        <p className="text-xs">{detail.keywords.zh}</p>
                        <p className="text-xs opacity-60">{detail.keywords.en}</p>
                        <p className="text-xs">{libraryImagePolicy(detail, PERSONAL_REFERENCE_TRIAL).note}</p>
                        <a href={selectedDetail?.source} target="_blank" rel="noopener noreferrer" className="text-xs underline">
                            原始来源与使用规则
                        </a>
                        <div className="flex gap-2">
                            <Button type="text" disabled={disabled || !libraryImagePolicy(detail, PERSONAL_REFERENCE_TRIAL).allowed} onClick={() => onChoose(selectedDetail!, variant, false)}>
                                加入{REFERENCE_ROLE_LABELS[detail.kind]}位置
                            </Button>
                            <Button type="text" disabled={disabled || !libraryImagePolicy(detail, PERSONAL_REFERENCE_TRIAL).allowed} onClick={() => onChoose(selectedDetail!, variant, true)}>
                                添加图片节点
                            </Button>
                        </div>
                    </div>
                )}
            </Modal>
            <Modal open={about} title="素材来源与授权" onCancel={() => setAbout(false)} footer={null}>
                <div className="space-y-3 text-sm">
                    <p>Open Pose & Costume：代码 MIT，图片、原始数据及第三方翻译另有权利。目录按已核验提交读取，不在本项目打包转载完整数据集。</p>
                    <p>人物：あぎ · CC0 1.0，原作者同时请求避免图片再分发。不用于冒充真实人物。仅按需读取和保存用户选中的图片。</p>
                    <p>
                        姿势、服装及深度图：ギア · 原站允许逐张作品参考，禁止批量下载、转载及再分发。上游维护者获得的仓库再分发授权不延伸给守守画布。
                        {PERSONAL_REFERENCE_TRIAL ? "当前仅本地个人试用启用按需浏览与逐张参考导入，不公开再分发素材。" : "公开发布环境未启用受限图片展示和导入。"}
                    </p>
                    <p>中文姿势名称来源 Anhao，原始数据未获商业再利用的明确许可，目录仅外部查询；需向相关权利人补充确认。</p>
                    <p>
                        <a className="underline" href="https://github.com/hongye007/open-pose-costume/blob/0cc039e096ac4ec2e2a24c2972e5e9c930235cb1/SOURCES.md" target="_blank" rel="noopener noreferrer">
                            完整来源及许可范围
                        </a>{" "}
                        ·{" "}
                        <a className="underline" href="https://github.com/hongye007/open-pose-costume/blob/0cc039e096ac4ec2e2a24c2972e5e9c930235cb1/THIRD_PARTY_NOTICES.md" target="_blank" rel="noopener noreferrer">
                            第三方声明
                        </a>
                    </p>
                </div>
            </Modal>
        </div>
    );
}
