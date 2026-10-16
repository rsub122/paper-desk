/** @type {import('next').NextConfig} */
const nextConfig = {
  reactCompiler: true,
  // The Daytona SDK uses dynamic require (form-data); bundling it breaks file upload.
  serverExternalPackages: ["@daytonaio/sdk"],
  compiler: {
    removeConsole: process.env.NODE_ENV === "production",
  },
  async redirects() {
    return [
      { source: "/", destination: "/dashboard/desk", permanent: false },
      { source: "/dashboard", destination: "/dashboard/desk", permanent: false },
    ];
  },
};

export default nextConfig;
