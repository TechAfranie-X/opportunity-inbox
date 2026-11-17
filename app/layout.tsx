import type { Metadata } from "next";
import { Instrument_Sans, Newsreader } from "next/font/google";
import "./globals.css";

// A precise sans carries everything operational; a serif sets titles. Two voices, never mixed within a line.
const ui = Instrument_Sans({
  variable: "--font-ui",
  subsets: ["latin"],
});
const serif = Newsreader({
  variable: "--font-serif",
  subsets: ["latin"],
  style: ["normal", "italic"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Opportunity Inbox",
  description:
    "Your recruiting, rebuilt from the emails you already have: where every application stands and what needs you today.",
};

/**
 * Applies the saved appearance before first paint so there is no flash.
 * Dark graphite is the default; "system" follows the OS. Kept inline and tiny on purpose.
 */
const THEME_SCRIPT = `try{var t=localStorage.getItem("oi-theme");if(t!=="light"&&t!=="system")t="dark";document.documentElement.dataset.theme=t}catch(e){document.documentElement.dataset.theme="dark"}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning className={`${ui.variable} ${serif.variable} h-full antialiased`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
