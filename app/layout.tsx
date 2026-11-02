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

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${ui.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
