import type { AutoCutTimeline } from "@/services/api/autocut";
/** Reorder/trim keeps edited subtitle text attached to its measured source interval. */
export function reflowTimeline(next: AutoCutTimeline, previous: AutoCutTimeline) {
    const before = previous.tracks.find((t) => t.kind === "video")?.clips || [];
    const video = next.tracks.find((t) => t.kind === "video");
    let cursor = 0;
    video?.clips.forEach((c) => {
        c.timeline_start = cursor;
        cursor += c.source_out - c.source_in;
    });
    next.target_duration = cursor;
    const changed = JSON.stringify(before.map((c) => [c.id, c.source_in, c.source_out, c.timeline_start])) !== JSON.stringify(video?.clips.map((c) => [c.id, c.source_in, c.source_out, c.timeline_start]));
    if (changed) {
        next.subtitles = previous.subtitles.flatMap((cue) =>
            (video?.clips || []).flatMap((c) => {
                const old = before.find((x) => x.id === c.id);
                if (!old) return [];
                const start = Math.max(cue.start, old.timeline_start),
                    end = Math.min(cue.end, old.timeline_start + old.source_out - old.source_in);
                if (end <= start) return [];
                const sourceStart = Math.max(old.source_in + start - old.timeline_start, c.source_in);
                const sourceEnd = Math.min(old.source_in + end - old.timeline_start, c.source_out);
                return sourceEnd > sourceStart ? [{ ...cue, id: crypto.randomUUID(), start: c.timeline_start + sourceStart - c.source_in, end: c.timeline_start + sourceEnd - c.source_in }] : [];
            }),
        );
        for (const track of next.tracks.filter((t) => t.kind === "audio")) track.clips = track.clips.filter((c) => c.timeline_start < cursor).map((c) => ({ ...c, source_out: Math.min(c.source_out, c.source_in + cursor - c.timeline_start) }));
    }
    return next;
}
