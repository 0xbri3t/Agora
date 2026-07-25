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
    {
      name: "Pau Gallego",
      github: "https://github.com/PauGallego",
      linkedin: "https://www.linkedin.com/in/pau-gallego-b975b0273/",
    },
  ] as Author[],
}
