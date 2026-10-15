import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["192.168.0.*"],
  async redirects() {
    return [{ source: "/pricing", destination: "/#supporter", permanent: true }];
  },
};

export default nextConfig;
