import { useEffect, useRef, useState } from 'react';
import type { KnowledgeAction, KnowledgeReceipt } from '@/services/api/knowledge';
export function useMarkdownImport(space: string, folder: string, allowed: boolean, prepareLeave: () => Promise<void>, run: (a: KnowledgeAction) => Promise<KnowledgeReceipt | undefined>) {
    const [reading, setReading] = useState(false), [error, setError] = useState('');
    const active = useRef(space), flight = useRef(false), mounted = useRef(true); active.current = space;
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    useEffect(() => { setError(''); setReading(false); }, [space]);
    const importFile = async (file: File) => {
        if (flight.current || !allowed) return;
        const owner = space; flight.current = true; setReading(true); setError('');
        try {
            if (!/\.(md|markdown)$/i.test(file.name)) throw new Error('请选择 .md 或 .markdown 文件，原文尚未导入');
            await prepareLeave(); const markdown = await file.text();
            if (!mounted.current || active.current !== owner) return;
            await run({ operationId: crypto.randomUUID(), action: 'document.import', payload: { title: file.name.replace(/\.(md|markdown)$/i, '') || '导入文档', markdown, folderId: folder || null } });
        } catch (e) { if (mounted.current && active.current === owner) setError((e as Error).message); }
        finally { flight.current = false; if (mounted.current && active.current === owner) setReading(false); }
    };
    return { reading, error, importFile };
}
