import Link from "next/link";

export default function NotFound() {
  return (
    <main style={{ minHeight: "100vh", background: "#09090b", color: "#f4f4f5", display: "grid", placeItems: "center", padding: 24 }}>
      <div style={{ maxWidth: 420, textAlign: "center" }}>
        <p style={{ color: "#71717a", fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", margin: "0 0 8px" }}>
          Not found
        </p>
        <h1 style={{ fontSize: 28, margin: "0 0 10px" }}>This page is not available.</h1>
        <p style={{ color: "#a1a1aa", fontSize: 14, lineHeight: 1.6, margin: "0 0 18px" }}>
          The explorer route may point to an entity that has not been indexed yet.
        </p>
        <Link href="/home" style={{ color: "#f4f4f5", textDecoration: "underline", textUnderlineOffset: 3 }}>
          Back to home
        </Link>
      </div>
    </main>
  );
}
