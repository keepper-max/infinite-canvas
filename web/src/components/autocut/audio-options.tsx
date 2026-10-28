import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Checkbox, Input, Select, theme } from "antd";
import { autoCutNarrationModels, type AutoCutAudioOptions, type NarrationModel } from "@/services/api/autocut";
import { formatCreditPoints } from "@/lib/credit-display";

export function AutoCutAudioOptionsFields({ value, onChange, disabled = false }: {
    value: AutoCutAudioOptions; onChange: (v: AutoCutAudioOptions) => void; disabled?: boolean;
}) {
    const { token } = theme.useToken();
    const catalog = useQuery({ queryKey: ["autocut-narration-models"], queryFn: autoCutNarrationModels });
    const [draft, setDraft] = useState(value.narration);
    const models = catalog.data?.models ?? [];
    const selected = models.find((m) => m.id === value.narration?.modelId);
    function selectModel(model: NarrationModel | undefined) {
        if (!model) return;
        const next = { modelId: model.id, text: value.narration?.text ?? draft?.text ?? "", parameters: Object.fromEntries(model.parameters.flatMap((p) => {
            const v = model.defaults[p.key] ?? p.defaultValue;
            return v === undefined ? [] : [[p.key, v]];
        })) };
        setDraft(next); onChange({ ...value, narration: next });
    }
    function update(next: NonNullable<AutoCutAudioOptions["narration"]>) { setDraft(next); onChange({ ...value, narration: next }); }
    return <div className="space-y-3">
        <label className="flex items-center justify-between gap-2 text-xs">
            原视频声音
            <Select aria-label="原视频声音" className="min-w-32" disabled={disabled} value={value.originalVolume ?? 1}
                options={[{ value: 1, label: "保留原声" }, { value: 0.2, label: "降低原声至20%" }, { value: 0, label: "关闭原声" }]}
                onChange={(v) => onChange({ ...value, originalVolume: v })} />
        </label>
        <Checkbox checked={!!value.narration} disabled={disabled || catalog.isPending || !models.length} onChange={(e) => {
            if (!e.target.checked) onChange({ ...value, narration: undefined });
            else if (draft && models.some((m) => m.id === draft.modelId)) onChange({ ...value, narration: draft });
            else selectModel(models[0]);
        }}>将文字生成配音</Checkbox>
        {catalog.isError && <Alert type="warning" showIcon title="配音模型加载失败，可稍后重试；原声剪辑仍可使用" action={<button type="button" onClick={() => void catalog.refetch()}>重试</button>} />}
        {!catalog.isPending && !catalog.isError && !models.length && <p className="text-xs" style={{ color: token.colorTextSecondary }}>当前没有启用的配音模型，可继续使用原声剪辑。</p>}
        {value.narration && <>
            <Select aria-label="配音模型" className="w-full" disabled={disabled} value={value.narration.modelId}
                options={models.map((m) => ({ value: m.id, label: m.displayName }))} onChange={(id) => selectModel(models.find((m) => m.id === id))} />
            {!selected && <Alert type="warning" title="原配音模型已不可用，请重新选择" />}
            <Input.TextArea className="mb-3" aria-label="配音文案" rows={3} showCount maxLength={selected?.limits.maxPromptChars} disabled={disabled}
                placeholder="输入要朗读的文字，系统会结合文案与剪辑要求选取画面" value={value.narration.text}
                onChange={(e) => update({ ...value.narration!, text: e.target.value })} />
            {selected?.parameters.map((p) => <label key={p.key} className="block space-y-1 text-xs">
                <span>{p.key === "voice" ? "音色" : p.key === "languageType" ? "配音语言" : p.description || p.key}</span>
                {p.options?.length ? <Select aria-label={`配音${p.key}`} className="w-full" disabled={disabled} value={value.narration!.parameters[p.key] as string}
                    options={p.options.map((v) => ({ value: String(v), label: String(v) }))}
                    onChange={(v) => update({ ...value.narration!, parameters: { ...value.narration!.parameters, [p.key]: p.options!.find((o) => String(o) === v) } })} />
                    : <Input aria-label={`配音${p.key}`} disabled={disabled} value={String(value.narration!.parameters[p.key] ?? "")}
                        onChange={(e) => update({ ...value.narration!, parameters: { ...value.narration!.parameters, [p.key]: p.type === "number" || p.type === "integer" ? Number(e.target.value) : e.target.value } })} />}
            </label>)}
            <p className="text-xs leading-5" style={{ color: token.colorTextSecondary }}>配音与剪辑共用本次预算；{catalog.data?.quotePoints ? `配音调用先占用 ${formatCreditPoints(catalog.data.quotePoints)}，按账本实扣。` : "调用前须有服务端报价。"} 文案会提交所选模型处理，配音过长会停止并保留结果，不自动付费重试。</p>
        </>}
    </div>;
}
