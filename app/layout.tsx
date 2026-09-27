import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { Providers } from "@/components/Providers";
import "./globals.css";

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: "ForMash 3D",
  description: "ForMash 3D — AI-powered 3D generation and asset creation platform.",
  openGraph: {
    title: "ForMash 3D",
    description: "ForMash 3D — AI-powered 3D generation and asset creation platform.",
  },
  keywords: [
    "AI 3D",
    "3D generation",
    "text to 3D",
    "image to 3D",
    "Blender",
    "Unreal Engine",
    "Unity",
    "Maya",
    "AI",
    "3D models",
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning className={`dark scroll-smooth ${inter.variable} ${jetbrainsMono.variable}`} data-scroll-behavior="smooth">
      <body
        className={`font-sans antialiased bg-background text-foreground relative overflow-x-hidden`}
      >
        {/* Global app background canvas gradient */}
        <div
          className="fixed inset-0 pointer-events-none z-[-1]"
          style={{ background: "radial-gradient(120% 80% at 50% -10%, #171717 0%, #0d0d0d 45%, #080808 100%)" }}
          aria-hidden="true"
        />
        {/* Overhead studio ambient warm light */}
        <div
          className="fixed top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[1100px] h-[550px] bg-[radial-gradient(ellipse_at_center,rgba(255,204,0,0.09)_0%,rgba(224,152,0,0.03)_45%,transparent_75%)] pointer-events-none z-0"
          aria-hidden="true"
        />
        {/* Cinematic vignette */}
        <div
          className="fixed inset-0 pointer-events-none z-[2] [box-shadow:inset_0_0_150px_hsl(var(--surface-0))]"
          aria-hidden="true"
        />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
