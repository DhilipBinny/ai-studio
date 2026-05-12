import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@ais-app/auth",
    "@ais-app/database",
    "@ais-app/email",
    "@ais-app/types",
    "@ais-app/validation",
  ],
  serverExternalPackages: [
    "@node-rs/argon2",
    "postgres",
    "nodemailer",
    "otplib",
    "@anthropic-ai/sdk",
    "openai",
  ],
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = config.externals || [];
      if (Array.isArray(config.externals)) {
        config.externals.push("@node-rs/argon2");
      }
    }
    return config;
  },
};

export default nextConfig;
