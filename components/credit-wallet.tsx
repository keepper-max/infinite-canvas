"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Gift, LockKeyhole, Ticket, Wallet } from "lucide-react";

type LedgerItem = { id: string; amount: number; reason: string; createdAt: string };
type CodeItem = { id: string; codeHint: string; credits: number; expiresAt: string; createdAt: string; redeemedAt: string | null; revokedAt: string | null };

const agreement = [
  ["一、适用与生效", "本协议适用于【网站名称】的个人用户积分充值与使用，由【运营主体全称】提供服务。请在充值前阅读；您勾选同意并完成充值后，本协议生效。"],
  ["二、充值与使用", "1 元人民币兑换 100 积分。积分仅用于本平台服务，不是现金，不可转让或提现；依法应退款的情形不受此限制。生成任务按页面公示的计费规则和供应商最终实际成本结算：人民币成本每 1 元扣 120 积分，不足 1 积分向上取整；非人民币成本按结算时公示的汇率换算。实际扣分在任务结算后显示于账户流水。"],
  ["三、有效期与余额", "购买积分自到账起有效 12 个月；赠送积分以活动页面说明为准。优先使用较早到期的积分。余额不足时不能提交新生成任务；已提交任务的最终扣分可能超过当时余额，后续充值积分先抵扣该差额。您可在积分账户查看余额、到期时间和消费记录。"],
  ["四、退款与异常", "未使用的付费积分可通过客服申请退款；已实际使用部分按消费记录核算。平台重复扣分、计费错误或未按约提供服务的，经核实后依法退还相应积分或款项。退款原则上退回原支付渠道；赠送积分不折算现金。"],
  ["五、争议与联系", "如对充值、扣分或退款有疑问，请通过【客服邮箱或站内客服】提交订单或任务编号。平台将核对账单和流水并处理。协议或价格规则调整将提前显著告知，原则上不影响调整前已提交的任务。未尽事宜按适用法律处理。"],
] as const;

function dateLabel(value: string) {
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

export function CreditWallet({ onBalanceChange }: { onBalanceChange: (balance: number) => void }) {
  const [balance, setBalance] = useState<number | null>(null);
  const [ledger, setLedger] = useState<LedgerItem[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [code, setCode] = useState("");
  const [redeeming, setRedeeming] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [credits, setCredits] = useState(1000);
  const [validDays, setValidDays] = useState(30);
  const [issuing, setIssuing] = useState(false);
  const [issuedCode, setIssuedCode] = useState("");
  const [codes, setCodes] = useState<CodeItem[]>([]);
  const [paymentEnabled, setPaymentEnabled] = useState(false);
  const [operatorName, setOperatorName] = useState("");
  const [supportEmail, setSupportEmail] = useState("");
  const [planId, setPlanId] = useState("starter");
  const [acceptedAgreement, setAcceptedAgreement] = useState(false);
  const [paying, setPaying] = useState(false);
  const [usdCnyRate, setUsdCnyRate] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch("/api/credits", { cache: "no-store" });
    if (!response.ok) { setError("积分账户暂时无法加载"); return; }
    const payload = await response.json();
    setBalance(payload.balance);
    setLedger(payload.ledger ?? []);
    setIsAdmin(Boolean(payload.isCodeAdmin));
    setPaymentEnabled(Boolean(payload.paymentEnabled));
    setOperatorName(payload.operatorName ?? "");
    setSupportEmail(payload.supportEmail ?? "");
    setUsdCnyRate(payload.usdCnyRate ?? null);
    onBalanceChange(payload.balance);
  }, [onBalanceChange]);

  const loadCodes = useCallback(async () => {
    const response = await fetch("/api/credits/activation-codes", { cache: "no-store" });
    if (response.ok) setCodes((await response.json()).codes ?? []);
  }, []);

  useEffect(() => {
    void fetch("/api/credits", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("积分账户暂时无法加载");
        return response.json();
      })
      .then((payload) => {
        setBalance(payload.balance);
        setLedger(payload.ledger ?? []);
        setIsAdmin(Boolean(payload.isCodeAdmin));
        setPaymentEnabled(Boolean(payload.paymentEnabled));
        setOperatorName(payload.operatorName ?? "");
        setSupportEmail(payload.supportEmail ?? "");
        setUsdCnyRate(payload.usdCnyRate ?? null);
        onBalanceChange(payload.balance);
      })
      .catch(() => setError("积分账户暂时无法加载"));
  }, [onBalanceChange]);
  useEffect(() => {
    if (!isAdmin) return;
    void fetch("/api/credits/activation-codes", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => { if (payload) setCodes(payload.codes ?? []); });
  }, [isAdmin]);
  useEffect(() => {
    const orderId = new URLSearchParams(window.location.search).get("order");
    if (!orderId) return;
    void fetch("/api/payments/orders", { cache: "no-store" }).then((response) => response.ok ? response.json() : null)
      .then((payload) => {
        const order = payload?.orders?.find((item: { id: string }) => item.id === orderId);
        if (order?.status === "paid") { setMessage("支付已到账，积分已加入余额"); void load(); }
        else setMessage("已从支付宝返回，订单到账以支付通知为准；若暂未显示，请稍后刷新。");
      }).catch(() => setError("订单状态暂时无法查询，请稍后刷新"));
  }, [load]);

  const redeem = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(""); setMessage(""); setRedeeming(true);
    try {
      const response = await fetch("/api/credits/redeem", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: code.trim() }) });
      const payload = await response.json();
      if (!response.ok) { setError(payload.error ?? "兑换失败，请稍后再试"); return; }
      setCode("");
      setMessage(`已领取 ${payload.added.toLocaleString()} 积分`);
      await load();
      if (isAdmin) await loadCodes();
    } catch { setError("网络异常，请稍后再试"); }
    finally { setRedeeming(false); }
  };

  const issue = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(""); setMessage(""); setIssuing(true); setIssuedCode("");
    try {
      const response = await fetch("/api/credits/activation-codes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ credits, validDays }) });
      const payload = await response.json();
      if (!response.ok) { setError(payload.error ?? "生成失败"); return; }
      setIssuedCode(payload.code);
      setMessage("激活码已生成，请现在复制保存；刷新后无法再次查看完整码。\n此码仅供免费赠送，请勿售卖。");
      await loadCodes();
    } catch { setError("网络异常，请稍后再试"); }
    finally { setIssuing(false); }
  };

  const revoke = async (id: string) => {
    if (!window.confirm("确定作废这个尚未使用的激活码吗？")) return;
    const response = await fetch("/api/credits/activation-codes", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    const payload = await response.json();
    if (!response.ok) setError(payload.error ?? "作废失败");
    else { setMessage("激活码已作废"); await loadCodes(); }
  };

  const pay = async () => {
    setError(""); setMessage(""); setPaying(true);
    try {
      const response = await fetch("/api/payments/create", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ planId, acceptedAgreement }) });
      const payload = await response.json();
      if (!response.ok) { setError(payload.error ?? "订单创建失败"); return; }
      const destination = new URL(payload.paymentUrl);
      if (destination.protocol !== "https:" || destination.hostname !== "openapi.alipay.com") throw new Error("支付地址不安全");
      window.location.assign(destination.toString());
    } catch { setError("暂时无法发起支付，请稍后再试"); }
    finally { setPaying(false); }
  };

  return (
    <div className="wallet-page">
      <div className="wallet-intro"><div><span className="eyebrow">YOUR ACCOUNT / CREDITS</span><h2>积分账户</h2><p>支付宝充值与激活码兑换进入同一积分余额，生成后按实际账单结算。</p></div><div className="wallet-state"><span className="wallet-state-dot" /> {paymentEnabled ? "充值已开放" : "充值待开放"}</div></div>
      <div className="wallet-grid">
        <section className="wallet-balance" aria-label="积分余额"><div className="wallet-balance-top"><Wallet size={22} /><span>可用积分</span></div><strong>{balance === null ? "—" : balance.toLocaleString()}</strong><p>真实任务按供应商实际账单结算；Mock 任务不扣分。</p><div className="wallet-rate">¥1 = 100 积分 · 人民币成本每 ¥1 扣 120 积分{usdCnyRate ? ` · 美元账单按 1 USD = ¥${usdCnyRate} 换算` : ""}</div></section>
        <section className="wallet-panel wallet-redeem"><div className="wallet-panel-heading"><span className="wallet-icon"><Ticket size={19} /></span><div><h3>兑换激活码</h3><p>仅可兑换平台免费赠送的激活码</p></div></div><form onSubmit={redeem} className="wallet-redeem-form"><label htmlFor="activation-code">激活码</label><div><input id="activation-code" value={code} onChange={(event) => setCode(event.target.value)} placeholder="JJ-XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX" autoComplete="off" required /><button className="primary-button" disabled={redeeming || !code.trim()}>{redeeming ? "兑换中…" : "立即兑换"}</button></div></form><p className="wallet-fineprint">激活码一经兑换不可重复使用；请勿向他人付费购买。</p></section>
      </div>
      {(error || message) && <div className={error ? "wallet-alert error" : "wallet-alert success"} role="status">{error || message}</div>}
      <section className="wallet-panel wallet-payment"><div className="wallet-panel-heading"><span className="wallet-icon locked"><LockKeyhole size={19} /></span><div><h3>支付宝充值</h3><p>{paymentEnabled ? "充值积分与激活码积分共同消费" : "付费充值暂未开放"}</p></div></div>{paymentEnabled ? <><div className="wallet-pay-plans">{[["starter", "¥10 · 1000 积分"], ["standard", "¥50 · 5000 积分"], ["plus", "¥100 · 10000 积分"]].map(([id, label]) => <label key={id}><input type="radio" name="credit-plan" value={id} checked={planId === id} onChange={() => setPlanId(id)} />{label}</label>)}</div><label className="wallet-pay-consent"><input type="checkbox" checked={acceptedAgreement} onChange={(event) => setAcceptedAgreement(event.target.checked)} />我已阅读并同意下方《积分充值与使用协议》</label><button className="primary-button" type="button" disabled={!acceptedAgreement || paying} onClick={() => void pay()}>{paying ? "创建订单中…" : "前往支付宝支付"}</button></> : <><span className="wallet-disabled-pill">未开放</span><p>完成商户审核及经营信息配置后开放，目前不能创建订单或付款。</p></>}<details className="wallet-agreement"><summary>查看《积分充值与使用协议（简明版）》{paymentEnabled ? "" : "预览"}</summary><div className="wallet-agreement-body">{!paymentEnabled && <p className="wallet-agreement-warning">上线前待确认：运营主体、网站名称、客服方式及经营资质。当前协议仅供预览，暂不用于充值签约。</p>}{agreement.map(([title, body]) => <div key={title}><h4>{title}</h4><p>{body.replace("【网站名称】", "镜界工坊").replace("【运营主体全称】", operatorName || "【运营主体全称】").replace("【客服邮箱或站内客服】", supportEmail || "【客服邮箱或站内客服】")}</p></div>)}</div></details></section>
      <section className="wallet-panel wallet-history"><div className="wallet-section-title"><div><span className="eyebrow">ACTIVITY</span><h3>积分流水</h3></div><span>最近 50 条</span></div>{ledger.length ? <div className="wallet-ledger">{ledger.map((item) => <div className="wallet-ledger-row" key={item.id}><div><strong>{item.reason}</strong><small>{dateLabel(item.createdAt)}</small></div><span className={item.amount >= 0 ? "plus" : "minus"}>{item.amount >= 0 ? "+" : ""}{item.amount.toLocaleString()}</span></div>)}</div> : <div className="wallet-empty">暂无变动记录；初始试用积分暂不显示在流水中</div>}</section>
      {isAdmin && <section className="wallet-panel wallet-admin"><div className="wallet-section-title"><div><span className="eyebrow">ADMIN / GIFT CODES</span><h3>免费激活码管理</h3></div><span><Gift size={15} /> 仅管理员可见</span></div><p className="wallet-admin-note">只用于平台免费赠送，不接收付款，不得作为充值卡对外售卖。完整激活码仅生成时显示一次。</p><form onSubmit={issue} className="wallet-issue-form"><label>赠送积分<input type="number" min="1" max="10000" step="1" value={credits} onChange={(event) => setCredits(Number(event.target.value))} required /></label><label>兑换有效期（天）<input type="number" min="1" max="90" step="1" value={validDays} onChange={(event) => setValidDays(Number(event.target.value))} required /></label><button className="primary-button" disabled={issuing}>{issuing ? "生成中…" : "生成免费激活码"}</button></form>{issuedCode && <div className="wallet-issued"><code>{issuedCode}</code><button type="button" onClick={() => void navigator.clipboard.writeText(issuedCode)}><Copy size={15} />复制</button></div>}<div className="wallet-code-list">{codes.map((item) => { const status = item.redeemedAt ? "已兑换" : item.revokedAt ? "已作废" : new Date(item.expiresAt) <= new Date() ? "已过期" : "待兑换"; return <div key={item.id} className="wallet-code-row"><span><Ticket size={15} /> 尾号 {item.codeHint}</span><strong>{item.credits.toLocaleString()} 积分</strong><small>{status} · 至 {dateLabel(item.expiresAt)}</small>{status === "待兑换" && <button type="button" onClick={() => void revoke(item.id)}>作废</button>}{status === "已兑换" && <Check size={15} className="wallet-used-icon" />}</div>; })}</div></section>}
    </div>
  );
}
