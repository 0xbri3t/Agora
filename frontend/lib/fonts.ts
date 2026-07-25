import localFont from "next/font/local"

export const displayFont = localFont({
  src: [
    { path: "../fonts/Array-Regular.woff2", weight: "400", style: "normal" },
    { path: "../fonts/Array-Semibold.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-display",
  display: "swap",
})
