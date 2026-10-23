import { useEffect, useState } from 'react';
import { getKnowledgeSpaces, ensureKnowledgeSpace, type KnowledgeSpace } from '@/services/api/knowledge';
import { listProjects, type ProjectSummary } from '@/services/api/platform';
export function useKnowledgeBootstrap(actor: string) {
    const [spaces, setSpaces] = useState<KnowledgeSpace[]>([]), [projects, setProjects] = useState<ProjectSummary[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState(''), [projectError, setProjectError] = useState(''), [attempt, retry] = useState(0);
    useEffect(() => {
        const controller = new AbortController(); setLoading(true); setError(''); setProjectError('');
        void listProjects(controller.signal).then(v => { if (!controller.signal.aborted) setProjects(v); }).catch(e => { if (!controller.signal.aborted) setProjectError(e.message); });
        void (async () => {
            try { let s = await getKnowledgeSpaces(controller.signal); if (!s.some(v => v.kind === 'personal')) { await ensureKnowledgeSpace('personal'); s = await getKnowledgeSpaces(controller.signal); } if (!controller.signal.aborted) setSpaces(s); }
            catch (e) { if (!controller.signal.aborted) setError((e as Error).message); }
            finally { if (!controller.signal.aborted) setLoading(false); }
        })();
        return () => controller.abort();
    }, [actor, attempt]);
    return { spaces, setSpaces, projects, loading, error, projectError, retry: () => retry(n => n + 1) };
}
