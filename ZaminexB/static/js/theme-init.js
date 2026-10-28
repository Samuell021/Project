(() => {
  const root = document.documentElement;
  let savedTheme = null;
  let savedBrandTheme = null;
  try {
    savedTheme = window.localStorage.getItem("zaminex-theme");
    savedBrandTheme = window.localStorage.getItem("zaminex-brand-theme");
  } catch {
    // Storage can be unavailable in private browsing; the app still starts with defaults.
  }

  const prefersDark = typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-color-scheme: dark)").matches;
  const isDark = savedTheme === "dark" || (savedTheme !== "light" && prefersDark);
  root.classList.toggle("dark", isDark);
  root.style.colorScheme = isDark ? "dark" : "light";

  const allowedBrandThemes = new Set(["green", "petroleum", "midnight", "plum", "copper", "slate"]);
  const serverBrandTheme = root.dataset.brandTheme;
  const brandTheme = allowedBrandThemes.has(serverBrandTheme)
    ? serverBrandTheme
    : allowedBrandThemes.has(savedBrandTheme)
      ? savedBrandTheme
      : "green";
  root.dataset.brandTheme = brandTheme;

  const lightColors = {
    green: "#176552",
    petroleum: "#164e63",
    midnight: "#191970",
    plum: "#6b3d80",
    copper: "#92502f",
    slate: "#475569",
  };
  const darkColors = {
    green: "#2ad3a6",
    petroleum: "#45b9d0",
    midnight: "#8990ff",
    plum: "#c89be0",
    copper: "#f0a777",
    slate: "#a9bfd4",
  };
  document.querySelector('meta[name="theme-color"]')?.setAttribute(
    "content",
    isDark ? darkColors[brandTheme] : lightColors[brandTheme],
  );
})();
