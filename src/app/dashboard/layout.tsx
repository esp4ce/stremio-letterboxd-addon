/** The admin dashboard is dark only: it re-scopes the theme tokens for its whole subtree. */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-theme="dark" className="min-h-dvh bg-background text-foreground">
      {children}
    </div>
  );
}
