import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 개발 서버의 /api 프록시 대상. 운영(8811)과 나란히 띄울 때 API_PORT=8812 처럼 바꾼다(scripts/dev.sh 가 넘긴다).
const API_PORT = process.env.API_PORT || "8811";

// 샘플 빌드(--mode sample): 정적 파일은 public-sample/(픽스처·_redirects·_headers), 제목에 '샘플'
const sampleTitle = {
  name: "sample-title",
  transformIndexHtml: (html) => html.replace("<title>자산 대시보드</title>", "<title>자산 대시보드 · 샘플</title>"),
};

export default defineConfig(({ mode }) => ({
  plugins: mode === "sample" ? [react(), sampleTitle] : [react()],
  publicDir: mode === "sample" ? "public-sample" : "public",
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${API_PORT}`,
        changeOrigin: true,
      },
    },
  },
}));
