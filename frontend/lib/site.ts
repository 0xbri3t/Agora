export type Author = {
  name: string
  github?: string
  linkedin?: string
}

export const site = {
  website: "https://futarfi.com",
  // Adjust to your preferred docs URL; currently points to the repo docs folder
  docs: "https://github.com/bri3t/Futarchy-DeFi-Protocol/",
  authors: [
    {
      name: "Arnau Briet",
      github: "https://github.com/bri3t",
      // Assumption based on naming convention; update if different
      linkedin: "https://www.linkedin.com/in/arnau-briet-roura/",
    },
  ] as Author[],
}
