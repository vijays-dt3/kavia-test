import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/** Vite configuration for the MAWOS browser application. */
export default defineConfig({
  plugins: [react()]
});
