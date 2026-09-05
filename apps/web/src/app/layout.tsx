import "~/styles/globals.css";

import { type Metadata } from "next";
import { Archivo, IBM_Plex_Mono, Silkscreen } from "next/font/google";

import { Nav } from "~/app/_components/nav";
import { TRPCReactProvider } from "~/trpc/react";

export const metadata: Metadata = {
  title: "Tappy",
  description: "An agent proposes. You approve it on the device. Only then does it happen.",
  icons: [{ rel: "icon", url: "/favicon.ico" }],
};

const archivo = Archivo({ subsets: ["latin"], variable: "--font-archivo" });
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
});
/** A bitmap face, used only inside the device panel, where it is the screen rather than text. */
const silkscreen = Silkscreen({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-silkscreen",
});

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${archivo.variable} ${plexMono.variable} ${silkscreen.variable}`}
    >
      <body className="min-h-screen bg-paper text-ink">
        <TRPCReactProvider>
          <Nav />
          {children}
        </TRPCReactProvider>
      </body>
    </html>
  );
}
