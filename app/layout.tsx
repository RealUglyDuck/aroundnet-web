import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/components/auth-provider";
import { TopBar } from "@/components/top-bar";
import { asset } from "@/lib/utils";

const description =
  "AR play-area setup and serve practice on iPhone, tournament management and video breakdown on the web.";

export const metadata: Metadata = {
  // Social images must be absolute; the site is served from the CNAME apex.
  metadataBase: new URL("https://aroundnet.co.uk"),
  title: {
    default: "AroundNet — Roundnet training, video and tournaments",
    template: "%s · AroundNet",
  },
  description,
  icons: { icon: asset("/app-icon.png") },
  openGraph: {
    title: "AroundNet",
    description,
    siteName: "AroundNet",
    type: "website",
    images: [asset("/app-icon.png")],
  },
  twitter: { card: "summary", title: "AroundNet", description },
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
