// @ts-check
import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import react from "@astrojs/react";
import node from "@astrojs/node";

// https://astro.build/config
export default defineConfig({
    output: "server",
    adapter: node({ 
        mode: "standalone" 
    }),
    // Añadimos esta sección para configurar el puerto y el host
    server: {
        port: 3000,
        host: true // Esto habilita el host 0.0.0.0
    },
    integrations: [react()],
    vite: {
        plugins: [tailwindcss()],
    },
});