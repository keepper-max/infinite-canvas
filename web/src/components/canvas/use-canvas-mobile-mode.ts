import { useEffect, useState } from "react";

export const CANVAS_MOBILE_QUERY = "(max-width: 900px) and (pointer: coarse), (max-width: 900px) and (hover: none)";

export function useCanvasMobileMode() {
    const [mobile, setMobile] = useState(() => (typeof window === "undefined" ? false : window.matchMedia(CANVAS_MOBILE_QUERY).matches));

    useEffect(() => {
        const query = window.matchMedia(CANVAS_MOBILE_QUERY);
        const update = () => setMobile(query.matches);
        update();
        query.addEventListener("change", update);
        return () => query.removeEventListener("change", update);
    }, []);

    return mobile;
}
