import { ImageResponse } from "next/og";

export const alt = "Releeve Stellar Operations Platform";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", position: "relative", flexDirection: "column", justifyContent: "space-between", padding: "64px", background: "#0a0a0a", color: "#f5f7f4", fontFamily: "Arial, sans-serif" }}>
      <div style={{ position: "absolute", inset: 0, display: "flex", border: "1px solid #272a27" }}>
        {[1, 2, 3, 4].map((item) => <div key={item} style={{ width: "25%", height: "100%", borderRight: item < 4 ? "1px solid #1c1f1c" : "none" }} />)}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "14px", fontSize: 26, fontWeight: 700 }}>
        <div style={{ display: "flex", width: 42, height: 42, alignItems: "center", justifyContent: "center", border: "1px solid #454a45", borderRadius: 5 }}>R</div>
        Releeve
      </div>
      <div style={{ display: "flex", position: "relative", flexDirection: "column", maxWidth: 980 }}>
        <div style={{ display: "flex", marginBottom: 24, alignItems: "center", gap: 10, color: "#a3ff5f", fontSize: 18, textTransform: "uppercase" }}><span style={{ width: 9, height: 9, background: "#a3ff5f" }} /> Built for Stellar and Soroban teams</div>
        <div style={{ fontSize: 72, lineHeight: 1.04, fontWeight: 540 }}>Stellar Operations Platform.</div>
      </div>
      <div style={{ display: "flex", position: "relative", justifyContent: "space-between", color: "#929891", fontSize: 18 }}><span>Fork. Shape. Monitor.</span><span>releeve.xyz</span></div>
    </div>,
    size,
  );
}
