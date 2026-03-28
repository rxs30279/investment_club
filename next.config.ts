import type { NextConfig } from 'next';
import path from 'path';

const nextConfig: NextConfig = {
  reactCompiler: true,
  turbopack: {
    root: path.join(__dirname), // Points to your project folder
  },
};

export default nextConfig;