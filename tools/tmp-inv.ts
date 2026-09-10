const token = (await import("fs")).readFileSync("/tmp/gate_token", "utf8").trim();
const res = await fetch("http://localhost:3000/api/gate/inventory", { headers: { authorization: `Bearer ${token}` } });
const j = (await res.json()) as any;
const r = j.rotation;
console.log("rotation:", r ? `owner-ready ${r.readyCount}/${r.targets.length} · activePlane ready=${r.activePlaneReady} done=${r.activePlaneDone}` : "null");
console.log("ready accounts:", r?.targets.filter((t: any) => t.ready).map((t: any) => t.account).join(","));
console.log("activePlane-ready:", r?.targets.filter((t: any) => t.activePlane === "ready").map((t: any) => t.account).join(","));
console.log("entries:", j.entries?.length, "summary:", JSON.stringify(j.summary).slice(0, 120));
