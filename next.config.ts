import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Development only: lets the app also be opened at 127.0.0.1, which keeps its own cookies, so a sample-mailbox session can run
  // beside a real sign-in on localhost without either disturbing the other.
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
