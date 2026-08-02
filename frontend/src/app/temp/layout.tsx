export default function TempLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ margin: 0, padding: 0, overflow: 'hidden', height: '100vh' }}>
      {children}
    </div>
  );
}
