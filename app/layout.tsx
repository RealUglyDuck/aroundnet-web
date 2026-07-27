import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/components/auth-provider";
import { TopBar } from "@/components/top-bar";
import { asset } from "@/lib/utils";

export const metadata: Metadata = {
  title: "AroundNet — Tournaments",
  description: "Run and follow Roundnet tournaments.",
  icons: { icon: asset("/app-icon.png") },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full flex flex-col bg-background text-text-primary">
        <AuthProvider>
          <TopBar />
          <main className="flex-1">{children}</main>
        </AuthProvider>
      </body>
    </html>
  );
}
