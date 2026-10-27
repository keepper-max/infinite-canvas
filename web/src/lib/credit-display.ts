/** User prices are already marked up and rounded by the server ledger. Never multiply them again. */
export function pointAmount(value: unknown): bigint | null {
    if (typeof value === "number" && (!Number.isSafeInteger(value) || value < 0)) return null;
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "bigint") return null;
    const text = String(value);
    return /^\d+$/.test(text) ? BigInt(text) : null;
}

export function formatCreditPoints(value: unknown): string {
    const points = pointAmount(value);
    return points === null ? "待结算" : `${new Intl.NumberFormat("zh-CN").format(points)} 积分`;
}

export function formatCreditSummary(points: unknown, pendingCalls = 0): string {
    const value = formatCreditPoints(points);
    return pendingCalls > 0 && pointAmount(points) !== null ? `${value}（另有 ${pendingCalls} 笔待结算）` : value;
}

export function formatCreditCharge(points: unknown, status: string | null | undefined): string {
    if (status === "charged") return formatCreditPoints(points);
    if (status === "free" && pointAmount(points) === BigInt(0)) return "0 积分";
    if (status === "payment_required") return pointAmount(points) === null ? "待核验" : `待支付 ${formatCreditPoints(points)}`;
    return "待结算";
}

export function summarizeCreditCalls(calls: readonly { credit_points?: string | null; credit_status?: string | null }[]): string {
    let charged = BigInt(0),
        due = BigInt(0),
        pending = 0,
        dueCalls = 0;
    for (const call of calls) {
        const points = pointAmount(call.credit_points);
        if (points !== null && call.credit_status === "charged") charged += points;
        else if (points !== null && call.credit_status === "payment_required") {
            due += points;
            dueCalls++;
        } else if (!(points === BigInt(0) && call.credit_status === "free")) pending++;
    }
    return [`已扣 ${formatCreditPoints(charged)}`, ...(dueCalls ? [`待支付 ${formatCreditPoints(due)}`] : []), ...(pending ? [`${pending} 笔待结算`] : [])].join(" · ");
}
