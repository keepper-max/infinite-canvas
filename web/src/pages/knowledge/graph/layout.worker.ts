import { forceSimulation, forceCenter, forceManyBody, forceLink, forceCollide, type SimulationNodeDatum } from "d3-force";
type Node = SimulationNodeDatum & { id: string };
let nodes: Node[] = [],
    hidden = false,
    reduced = false;
const sim = forceSimulation<Node>().stop().force("center", forceCenter(0, 0).strength(0.04)).force("charge", forceManyBody().strength(-170)).force("collide", forceCollide<Node>(13)).velocityDecay(0.4).alphaDecay(0.035).alphaMin(0.002);
let ticks = 0,
    totalMs = 0,
    maxTickMs = 0;
function send(ended = false) {
    postMessage({ type: "positions", nodes: nodes.map((n) => ({ id: n.id, x: n.x, y: n.y })), alpha: sim.alpha(), ended, ticks, totalMs, maxTickMs });
}
// A stopped D3 simulation lets this worker schedule physics independently of paint.
let timer: ReturnType<typeof setTimeout> | undefined;
function stop() {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    sim.stop();
}
function step() {
    timer = undefined;
    if (hidden) return;
    const start = performance.now();
    sim.tick();
    const ms = performance.now() - start;
    ticks++;
    totalMs += ms;
    maxTickMs = Math.max(maxTickMs, ms);
    const ended = sim.alpha() < sim.alphaMin();
    send(ended);
    if (!ended) timer = setTimeout(step, 16);
}
function run() {
    stop();
    if (hidden) return;
    if (reduced) {
        const start = performance.now();
        while (sim.alpha() >= sim.alphaMin()) {
            sim.tick();
            ticks++;
        }
        totalMs += performance.now() - start;
        send(true);
    } else step();
}
onmessage = ({ data: m }) => {
    if (m.type === "data") {
        const previous = new Map(nodes.map((n) => [n.id, n]));
        nodes = m.nodes.map((n: Node) => Object.assign(previous.get(n.id) || {}, n));
        sim.nodes(nodes).force(
            "link",
            forceLink<Node, { source: string | Node; target: string | Node }>(m.edges.map((e: any) => ({ ...e })))
                .id((n) => n.id)
                .distance(95)
                .strength(0.14),
        );
        reduced = m.reduced;
        if (!nodes.length) {
            stop();
            sim.alpha(0);
            send(true);
            return;
        }
        sim.alpha(m.warm ? 0.18 : 0.8).alphaTarget(0);
        run();
    } else if (m.type === "drag") {
        const n = nodes.find((n) => n.id === m.id);
        if (!n) return;
        n.fx = m.released ? null : m.x;
        n.fy = m.released ? null : m.y;
        if (!m.released) {
            n.x = m.x;
            n.y = m.y;
        }
        sim.alpha(Math.max(sim.alpha(), 0.16)).alphaTarget(m.released ? 0 : 0.04);
        run();
    } else if (m.type === "pause") {
        hidden = m.hidden;
        if (hidden) stop();
        else if (sim.alpha() >= sim.alphaMin()) run();
    } else if (m.type === "reduced") {
        reduced = m.value;
        run();
    }
};
