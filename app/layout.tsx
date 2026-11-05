import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pantalan Jelly | Interactive 3D Philippine Port Diorama",
  description: "A procedural translucent sea jelly diorama featuring an authentic miniature Philippine Pantalan port.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased bg-[#070b12] text-slate-100 min-h-screen w-full overflow-hidden">
        {children}
      </body>
    </html>
  );
}

