import type { NextConfig } from 'next';
const config: NextConfig = {
  output: 'export',
  poweredByHeader: false,
  devIndicators: false,
  images: { unoptimized: true },
  webpack(config) {
    config.resolve.extensionAlias = { '.js': ['.ts', '.tsx', '.js'] };
    return config;
  },
};
export default config;
