import { defineWindow } from "@cordy/electro";
import solid from 'vite-plugin-solid';
import tailwind from '@tailwindcss/vite';

export default defineWindow({
    name: "main",
    entry: "./index.html",
    type: "browser-window",
    features: ["app-core", "settings", "sync"],
    vite: {
        plugins: [
            tailwind(),
            solid(),
        ],
        resolve: {
            alias: {
                "@": "./",
            },
        },
    },
});
