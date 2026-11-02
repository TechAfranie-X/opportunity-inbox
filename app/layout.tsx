import type { Metadata } from "next";
import { Instrument_Sans } from "next/font/google";
import "./globals.css";

// One family carries the whole interface; weight and size do the hierarchy.
const ui = Instrument_Sans({
  variable: "--font-ui",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Opportunity Inbox",
  description:
    "Your recruiting, rebuilt from the emails you already have: where every application stands and what needs you today.",
};

/**
 * Applies the saved appearance before first paint so there is no flash.
 * Light is the default; "system" follows the OS. Kept inline and tiny on purpose.
 */
const THEME_SCRIPT = `try{var t=localStorage.getItem("oi-theme");if(t!=="dark"&&t!=="system")t="light";document.documentElement.dataset.theme=t}catch(e){document.documentElement.dataset.theme="light"}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" data-theme="light" suppressHydrationWarning className={`${ui.variable} h-full antialiased`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
