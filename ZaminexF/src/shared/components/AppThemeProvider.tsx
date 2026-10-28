import type { ReactNode } from "react";
import { ThemeProvider } from "next-themes";

type AppThemeProviderProps = {
  children: ReactNode;
};

function AppThemeProvider({ children }: AppThemeProviderProps) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      storageKey="zaminex-theme"
      disableTransitionOnChange
    >
      {children}
    </ThemeProvider>
  );
}

export { AppThemeProvider };
