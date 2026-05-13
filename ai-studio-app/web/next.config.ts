import type { NextConfig } from "next";
import { resolve } from "path";

const nextConfig: NextConfig = {
  outputFileTracingRoot: resolve(__dirname, "../../"),
  transpilePackages: [
    "@ais-app/agent-runtime",
    "@ais-app/auth",
    "@ais-app/database",
    "@ais-app/email",
    "@ais-app/types",
    "@ais-app/validation",
    "@ais/agent-core",
    "@ais/mcp-client",
    "@ais/memory-engine",
    "@ais/provider-bridge",
    "@ais/rag-engine",
    "@ais/security",
    "@ais/tool-platform",
    "@ais/tools-common",
    "@ais/types",
  ],
  serverExternalPackages: [
    "@node-rs/argon2",
    "postgres",
    "nodemailer",
    "otplib",
    "@anthropic-ai/sdk",
    "openai",
    "@huggingface/transformers",
    "@modelcontextprotocol/sdk",
    "onnxruntime-node",
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
