/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      fontFamily: { mono: ["Consolas", "ui-monospace", "SFMono-Regular", "monospace"] },
    },
  },
  plugins: [],
};
