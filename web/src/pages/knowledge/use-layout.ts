import { useEffect, useState } from 'react';
type Layout = { nav: boolean; refs: boolean; navWidth: number; refWidth: number };
export function useKnowledgeLayout(actor: string) {
    const key = 'knowledge:layout:' + actor;
    const [desktop, setDesktop] = useState<Layout>(() => {
        try { const s = JSON.parse(localStorage.getItem(key) || '{}'); return { nav: s.nav !== false, refs: s.refs !== false, navWidth: Math.max(220, Math.min(420, Number(s.navWidth) || 268)), refWidth: Math.max(220, Math.min(420, Number(s.refWidth) || 252)) }; }
        catch { return { nav: true, refs: true, navWidth: 268, refWidth: 252 }; }
    });
    const [narrow, setNarrow] = useState(() => matchMedia('(max-width:850px)').matches), [mobileNav, setMobileNav] = useState(false), [mobileRefs, setMobileRefs] = useState(false);
    useEffect(() => { const m = matchMedia('(max-width:850px)'), change = () => { setNarrow(m.matches); setMobileNav(false); setMobileRefs(false); }; m.addEventListener('change', change); return () => m.removeEventListener('change', change); }, []);
    useEffect(() => { try { localStorage.setItem(key, JSON.stringify(desktop)); } catch { /* Layout persistence never blocks editing. */ } }, [desktop, key]);
    const width = (field: 'navWidth' | 'refWidth', value: number | ((n: number) => number)) => setDesktop(s => ({ ...s, [field]: typeof value === 'function' ? value(s[field]) : value }));
    return { nav: narrow ? mobileNav : desktop.nav, refs: narrow ? mobileRefs : desktop.refs, navWidth: desktop.navWidth, refWidth: desktop.refWidth,
        setNav: (v: boolean) => narrow ? setMobileNav(v) : setDesktop(s => ({ ...s, nav: v })), setRefs: (v: boolean) => narrow ? setMobileRefs(v) : setDesktop(s => ({ ...s, refs: v })),
        setNavWidth: (v: number | ((n: number) => number)) => width('navWidth', v), setRefWidth: (v: number | ((n: number) => number)) => width('refWidth', v) };
}
