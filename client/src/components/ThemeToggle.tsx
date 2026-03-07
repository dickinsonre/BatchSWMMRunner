import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Moon, Sun, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type ThemeName = "default" | "auburn" | "autodesk" | "uf" | "osu";
type DarkMode = "light" | "dark";

const THEME_OPTIONS: { value: ThemeName; label: string }[] = [
  { value: "default", label: "Default" },
  { value: "auburn", label: "Auburn" },
  { value: "autodesk", label: "Autodesk" },
  { value: "uf", label: "UF" },
  { value: "osu", label: "OSU" },
];

const THEME_CLASS_MAP: Record<ThemeName, string | null> = {
  default: null,
  auburn: "theme-auburn",
  autodesk: "theme-autodesk",
  uf: "theme-uf",
  osu: "theme-osu",
};

function getStoredTheme(): ThemeName {
  if (typeof window === "undefined") return "default";
  const stored = localStorage.getItem("color-theme");
  if (stored && stored in THEME_CLASS_MAP) return stored as ThemeName;
  return "default";
}

function getStoredDarkMode(): DarkMode {
  if (typeof window === "undefined") return "light";
  const stored = localStorage.getItem("theme");
  if (stored === "dark" || stored === "light") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export default function ThemeToggle() {
  const [darkMode, setDarkMode] = useState<DarkMode>(getStoredDarkMode);
  const [themeName, setThemeName] = useState<ThemeName>(getStoredTheme);

  useEffect(() => {
    const root = document.documentElement;

    Object.values(THEME_CLASS_MAP).forEach((cls) => {
      if (cls) root.classList.remove(cls);
    });

    if (darkMode === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }

    const themeClass = THEME_CLASS_MAP[themeName];
    if (themeClass) {
      root.classList.add(themeClass);
    }

    localStorage.setItem("theme", darkMode);
    localStorage.setItem("color-theme", themeName);
  }, [darkMode, themeName]);

  const toggleDarkMode = () => {
    setDarkMode((prev) => (prev === "light" ? "dark" : "light"));
  };

  const activeLabel = THEME_OPTIONS.find((t) => t.value === themeName)?.label ?? "Default";

  return (
    <div className="flex items-center gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            data-testid="button-theme-select"
            className="gap-1"
          >
            <span className="text-xs" data-testid="text-active-theme">{activeLabel}</span>
            <ChevronDown className="h-3 w-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {THEME_OPTIONS.map((option) => (
            <DropdownMenuItem
              key={option.value}
              onClick={() => setThemeName(option.value)}
              data-testid={`menu-item-theme-${option.value}`}
              className={themeName === option.value ? "font-semibold" : ""}
            >
              {option.label}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={toggleDarkMode}
            data-testid="menu-item-toggle-dark"
          >
            {darkMode === "light" ? (
              <><Moon className="h-4 w-4 mr-2" /> Dark Mode</>
            ) : (
              <><Sun className="h-4 w-4 mr-2" /> Light Mode</>
            )}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Button
        size="icon"
        variant="ghost"
        onClick={toggleDarkMode}
        data-testid="button-theme-toggle"
      >
        {darkMode === "light" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
      </Button>
    </div>
  );
}
